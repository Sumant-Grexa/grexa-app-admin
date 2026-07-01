import { getReleaseConfig } from "../../config/releaseConfig.js";

// ─── Release State ─────────────────────────────────────────────────────────────
export const releaseState = {
  status: "idle", // 'idle' | 'running' | 'success' | 'error'
  log: [],
  startedAt: null,
  finishedAt: null,
  android: { runId: null, uploaded: false },
  ios: { runId: null, uploaded: false },
  tagName: null,
  releaseUrl: null,
};
const RELEASE_BRANCH = "master";

class GitHubApiError extends Error {
  constructor(method, path, status, details) {
    super(`GitHub ${method} ${path} -> ${status}: ${details}`);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

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

  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const details = JSON.stringify(parsed?.message ?? parsed ?? "unknown_error");
    throw new GitHubApiError(method, path, res.status, details);
  }

  return res.status === 204 ? null : parsed;
}

async function dispatchWorkflow(token, repo, workflow, inputs, ref) {
  await ghFetch("POST", `/repos/${repo}/actions/workflows/${workflow}/dispatches`, token, {
    ref,
    inputs,
  });
}

// Finds the first run for `workflow` whose created_at is at or after `afterMs`.
// Retries for up to ~30 s to account for GitHub's run creation delay.
async function getLatestRunId(token, repo, workflow, afterMs) {
  for (let i = 0; i < 15; i++) {
    const data = await ghFetch("GET", `/repos/${repo}/actions/workflows/${workflow}/runs?per_page=5`, token);
    const run = data.workflow_runs?.find((r) => new Date(r.created_at).getTime() >= afterMs);
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

function encodeRefPath(ref) {
  return ref
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function getBranchHeadSha(token, repo, branch) {
  const encodedBranch = encodeRefPath(branch);
  const ref = await ghFetch("GET", `/repos/${repo}/git/ref/heads/${encodedBranch}`, token);
  return ref.object?.sha;
}

async function ensureTagExists(token, repo, branch, tagName, append) {
  const sha = await getBranchHeadSha(token, repo, branch);
  if (!sha) throw new Error(`Could not resolve HEAD SHA for branch "${branch}"`);

  try {
    await ghFetch("POST", `/repos/${repo}/git/refs`, token, {
      ref: `refs/tags/${tagName}`,
      sha,
    });
    append(`Tag created: ${tagName} -> ${sha.slice(0, 7)}`);
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 422) {
      append(`Tag already exists: ${tagName}`);
      return;
    }
    throw err;
  }
}

async function generateReleaseNotes(token, repo, tagName, branch, fallbackNotes, append) {
  try {
    const data = await ghFetch("POST", `/repos/${repo}/releases/generate-notes`, token, {
      tag_name: tagName,
      target_commitish: branch,
    });

    const body = (data?.body || "").trim();
    if (body) {
      append("Generated GitHub release notes.");
      return body;
    }
  } catch (err) {
    append(`Failed to auto-generate release notes, falling back to input notes: ${err.message}`);
  }

  return (fallbackNotes || "").trim() || `Release ${tagName}`;
}

async function ensureGitHubRelease(token, repo, tagName, branch, body, append) {
  try {
    const created = await ghFetch("POST", `/repos/${repo}/releases`, token, {
      tag_name: tagName,
      target_commitish: branch,
      name: `Release ${tagName}`,
      body,
      draft: false,
      prerelease: false,
    });
    append(`GitHub release created: ${created.html_url}`);
    return created;
  } catch (err) {
    if (!(err instanceof GitHubApiError) || err.status !== 422) throw err;

    const existing = await ghFetch(
      "GET",
      `/repos/${repo}/releases/tags/${encodeURIComponent(tagName)}`,
      token
    );

    await ghFetch("PATCH", `/repos/${repo}/releases/${existing.id}`, token, {
      target_commitish: branch,
      name: `Release ${tagName}`,
      body,
      draft: false,
      prerelease: false,
    });

    append(`GitHub release already existed. Updated: ${existing.html_url}`);
    return { ...existing, body };
  }
}

async function postGoogleChatRelease(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google Chat webhook failed (${response.status}): ${text || response.statusText}`);
  }
}

function buildChatMessage({
  tagName,
  generatedNotes,
  inputNotes,
  platforms,
  results,
  userFraction,
  iosReleaseType,
}) {
  const notes = (generatedNotes || inputNotes || "").trim();
  const maxNotesLength = 3000;
  const clippedNotes = notes.length > maxNotesLength ? `${notes.slice(0, maxNotesLength)}\n...[truncated]` : notes;
  const points = extractNotePoints(clippedNotes);

  const androidRequested = platforms.includes("android");
  const iosRequested = platforms.includes("ios");
  const androidDone = results.some((r) => r.platform === "android" && r.ok);
  const iosDone = results.some((r) => r.platform === "ios" && r.ok);
  const androidPercent = Math.max(1, Math.min(100, Number.parseInt(String(Math.round((userFraction ?? 0.1) * 100)), 10) || 10));

  const titleParts = [];
  if (androidRequested) {
    if (androidDone) titleParts.push(`rolling out to ${androidPercent}% on android`);
  }
  if (iosRequested) {
    if (iosDone) titleParts.push(`${describeIosRollout(iosReleaseType)} on IOS`);
  }
  titleParts.push("100% on web");

  const dateLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(new Date());
  const title = `${dateLabel} ${tagName} release ${joinWithAnd(titleParts)}`;

  const text = [title, "", ...points.map((p) => `• ${p}`)];
  return { text: text.join("\n") };
}

function joinWithAnd(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function describeIosRollout(rolloutType) {
  if (rolloutType === "phased") return "phased rollout";
  if (rolloutType === "manual") return "manual rollout";
  return "full rollout";
}

function extractNotePoints(notes) {
  const lines = String(notes || "").split("\n").map((line) => line.trim());
  const bulletPoints = lines
    .filter((line) => line.startsWith("* ") || line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);

  if (bulletPoints.length > 0) return bulletPoints;

  return lines
    .filter((line) => line && !line.startsWith("#") && !/^full changelog:/i.test(line))
    .slice(0, 30);
}

// ─── Facade ────────────────────────────────────────────────────────────────────
export async function runReleasePipeline(options) {
  const { githubToken, githubRepo, googleChatWebhookUrl } = getReleaseConfig();
  const log = [];
  const append = (line) => {
    log.push(line);
    console.log(`[release] ${line}`);
  };

  Object.assign(releaseState, {
    status: "running",
    log,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    android: { runId: null, uploaded: false },
    ios: { runId: null, uploaded: false },
    tagName: null,
    releaseUrl: null,
  });

  try {
    const {
      version,
      releaseNotes,
      platforms,
      track,
      userFraction,
      iosReleaseType,
      runBuildRunner,
    } = options;

    const tagName = `v${version}`;
    const dispatchedAt = Date.now();

    // ── Dispatch ──────────────────────────────────────────────────────────────
    const dispatches = [];

    if (platforms.includes("android")) {
      append("Dispatching Android release workflow...");
      dispatches.push(
        dispatchWorkflow(
          githubToken,
          githubRepo,
          "release-android.yml",
          {
            version,
            release_notes: releaseNotes,
            track: track ?? "production",
            user_fraction: String(Math.round((userFraction ?? 0.1) * 100)),
            run_build_runner: runBuildRunner ? "true" : "false",
          },
          RELEASE_BRANCH
        ).then(() => append("[android] workflow dispatched"))
      );
    }

    if (platforms.includes("ios")) {
      append("Dispatching iOS release workflow...");
      dispatches.push(
        dispatchWorkflow(
          githubToken,
          githubRepo,
          "release-ios.yml",
          {
            version,
            release_notes: releaseNotes,
            rollout_type: iosReleaseType ?? "full",
            run_build_runner: runBuildRunner ? "true" : "false",
          },
          RELEASE_BRANCH
        ).then(() => append("[ios] workflow dispatched"))
      );
    }

    await Promise.all(dispatches);

    // ── Resolve run IDs ───────────────────────────────────────────────────────
    const runIdFetches = [];

    if (platforms.includes("android")) {
      runIdFetches.push(
        getLatestRunId(githubToken, githubRepo, "release-android.yml", dispatchedAt).then((id) => {
          releaseState.android.runId = id;
          append(`[android] run ID: ${id}`);
          return { platform: "android", id };
        })
      );
    }

    if (platforms.includes("ios")) {
      runIdFetches.push(
        getLatestRunId(githubToken, githubRepo, "release-ios.yml", dispatchedAt).then((id) => {
          releaseState.ios.runId = id;
          append(`[ios] run ID: ${id}`);
          return { platform: "ios", id };
        })
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
    releaseState.android.uploaded = succeeded.some((s) => s.platform === "android");
    releaseState.ios.uploaded = succeeded.some((s) => s.platform === "ios");

    for (const f of failed) append(`[${f.platform}] ✗ ${f.error}`);
    for (const s of succeeded) append(`[${s.platform}] ✓ complete`);

    if (succeeded.length === 0) {
      throw new Error(`All workflows failed: ${failed.map((f) => `${f.platform}: ${f.error}`).join("; ")}`);
    }

    // ── Finalization in app (tag + release + chat) ───────────────────────────
    append("Finalizing release in GitHub...");
    await ensureTagExists(githubToken, githubRepo, RELEASE_BRANCH, tagName, append);

    const githubNotes = await generateReleaseNotes(
      githubToken,
      githubRepo,
      tagName,
      RELEASE_BRANCH,
      releaseNotes,
      append
    );

    const release = await ensureGitHubRelease(
      githubToken,
      githubRepo,
      tagName,
      RELEASE_BRANCH,
      githubNotes,
      append
    );

    if (!googleChatWebhookUrl) {
      throw new Error("Missing env var: GOOGLE_CHAT_WEBHOOK_URL");
    }

    const chatPayload = buildChatMessage({
      tagName,
      generatedNotes: githubNotes,
      inputNotes: releaseNotes,
      platforms,
      results,
      userFraction,
      iosReleaseType,
    });
    await postGoogleChatRelease(googleChatWebhookUrl, chatPayload);
    append("Posted release notes to Google Chat.");

    Object.assign(releaseState, {
      status: "success",
      finishedAt: new Date().toISOString(),
      tagName,
      releaseUrl: release.html_url ?? null,
    });
  } catch (err) {
    append(`Pipeline failed: ${err.message}`);
    Object.assign(releaseState, {
      status: "error",
      finishedAt: new Date().toISOString(),
    });
  }
}
