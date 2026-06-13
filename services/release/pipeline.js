import { getReleaseConfig } from "../../config/releaseConfig.js";

// ─── Release State ─────────────────────────────────────────────────────────────
export const releaseState = {
  status: "idle",   // 'idle' | 'running' | 'success' | 'error'
  log: [],
  startedAt: null,
  finishedAt: null,
  android: { runId: null },
  ios: { runId: null },
  tagName: null,
};

// ─── GitHub API helpers ────────────────────────────────────────────────────────
async function ghFetch(method, path, token, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${JSON.stringify(err.message ?? err)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function dispatchWorkflow(token, repo, workflow, inputs) {
  const ref = process.env.GITHUB_RELEASE_BRANCH || "master";
  await ghFetch("POST", `/repos/${repo}/actions/workflows/${workflow}/dispatches`, token, {
    ref,
    inputs,
  });
}

// Finds the first run for `workflow` whose created_at is at or after `afterMs`.
// Retries for up to ~30 s to account for GitHub's run creation delay.
async function getLatestRunId(token, repo, workflow, afterMs) {
  for (let i = 0; i < 15; i++) {
    const data = await ghFetch(
      "GET",
      `/repos/${repo}/actions/workflows/${workflow}/runs?per_page=5`,
      token
    );
    const run = data.workflow_runs?.find(
      (r) => new Date(r.created_at).getTime() >= afterMs
    );
    if (run) return run.id;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Could not find dispatched run for workflow "${workflow}" after 45 s`);
}

// Polls a run every 15 s for up to 30 min, resolves on success, rejects on failure.
async function pollRun(token, repo, runId, append, label, intervalMs = 15000, maxAttempts = 120) {
  for (let i = 1; i <= maxAttempts; i++) {
    const run = await ghFetch("GET", `/repos/${repo}/actions/runs/${runId}`, token);
    const { status, conclusion } = run;
    append(`[${label}] run ${runId}: ${status}${conclusion ? ` / ${conclusion}` : ""}`);

    if (status === "completed") {
      if (conclusion === "success") return;
      throw new Error(`[${label}] workflow run failed: ${conclusion}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`[${label}] timed out after ${(maxAttempts * intervalMs) / 60000} min`);
}

// ─── Facade ────────────────────────────────────────────────────────────────────
export async function runReleasePipeline(options) {
  const { githubToken, githubRepo } = getReleaseConfig();
  const log = [];
  const append = (line) => { log.push(line); console.log(`[release] ${line}`); };

  Object.assign(releaseState, {
    status: "running",
    log,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    android: { runId: null },
    ios: { runId: null },
    tagName: null,
  });

  try {
    const { version, releaseNotes, platforms, track, userFraction, iosReleaseType, runBuildRunner } = options;
    const tagName = `v${version}`;
    const dispatchedAt = Date.now();

    // ── Dispatch ──────────────────────────────────────────────────────────────
    const dispatches = [];

    if (platforms.includes("android")) {
      append("Dispatching Android release workflow…");
      dispatches.push(
        dispatchWorkflow(githubToken, githubRepo, "release-android.yml", {
          version,
          release_notes: releaseNotes,
          track: track ?? "production",
          user_fraction: String(Math.round((userFraction ?? 0.1) * 100)),
          run_build_runner: runBuildRunner ? "true" : "false",
        }).then(() => append("[android] workflow dispatched"))
      );
    }

    if (platforms.includes("ios")) {
      append("Dispatching iOS release workflow…");
      dispatches.push(
        dispatchWorkflow(githubToken, githubRepo, "release-ios.yml", {
          version,
          release_notes: releaseNotes,
          rollout_type: iosReleaseType ?? "full",
          run_build_runner: runBuildRunner ? "true" : "false",
        }).then(() => append("[ios] workflow dispatched"))
      );
    }

    await Promise.all(dispatches);

    // ── Resolve run IDs ───────────────────────────────────────────────────────
    const runIdFetches = [];

    if (platforms.includes("android")) {
      runIdFetches.push(
        getLatestRunId(githubToken, githubRepo, "release-android.yml", dispatchedAt).then(
          (id) => {
            releaseState.android.runId = id;
            append(`[android] run ID: ${id}`);
            return { platform: "android", id };
          }
        )
      );
    }

    if (platforms.includes("ios")) {
      runIdFetches.push(
        getLatestRunId(githubToken, githubRepo, "release-ios.yml", dispatchedAt).then(
          (id) => {
            releaseState.ios.runId = id;
            append(`[ios] run ID: ${id}`);
            return { platform: "ios", id };
          }
        )
      );
    }

    const runIds = await Promise.all(runIdFetches);

    // ── Poll concurrently ─────────────────────────────────────────────────────
    const results = await Promise.all(
      runIds.map(({ platform, id }) =>
        pollRun(githubToken, githubRepo, id, append, platform)
          .then(() => ({ platform, ok: true }))
          .catch((err) => ({ platform, ok: false, error: err.message }))
      )
    );

    const failed = results.filter((r) => !r.ok);
    const succeeded = results.filter((r) => r.ok);

    for (const f of failed) append(`[${f.platform}] ✗ ${f.error}`);
    for (const s of succeeded) append(`[${s.platform}] ✓ complete`);

    if (succeeded.length === 0) {
      throw new Error(
        `All workflows failed: ${failed.map((f) => `${f.platform}: ${f.error}`).join("; ")}`
      );
    }

    Object.assign(releaseState, {
      status: "success",
      finishedAt: new Date().toISOString(),
      tagName,
    });
  } catch (err) {
    append(`Pipeline failed: ${err.message}`);
    Object.assign(releaseState, { status: "error", finishedAt: new Date().toISOString() });
  }
}
