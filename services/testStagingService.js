import simpleGit from "simple-git";
import { getEnvs } from "../config/environments.js";

const GITHUB_PR_REGEX = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;

export const testStagingState = {
  status: "idle", // 'idle' | 'running' | 'success' | 'error'
  log: [],
  startedAt: null,
  finishedAt: null,
  meta: null,
};

class PlaneApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} details
   */
  constructor(message, status, details) {
    super(message);
    this.name = "PlaneApiError";
    this.status = status;
    this.details = details;
  }
}

/** @returns {{ baseUrl: string, workspaceSlug: string, apiKey: string, scopedProjectIds: string[] }} */
function getPlaneConfig() {
  const baseUrl = String(process.env.PLANE_API_BASE_URL || "https://api.plane.com").replace(/\/$/, "");
  const workspaceSlug = String(process.env.PLANE_WORKSPACE_SLUG || "").trim();
  const apiKey = String(process.env.PLANE_API_KEY || "").trim();
  const scopedProjectIds = String(process.env.PLANE_TEST_STAGING_PROJECT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!workspaceSlug) {
    throw new Error("PLANE_WORKSPACE_SLUG is required");
  }
  if (!apiKey) {
    throw new Error("PLANE_API_KEY is required");
  }

  return { baseUrl, workspaceSlug, apiKey, scopedProjectIds };
}

/**
 * @param {string} key
 * @returns {Record<string, string>}
 */
function buildPlaneHeaders(key) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${key}`,
    "x-api-key": key,
  };
}

/**
 * @param {string} path
 * @param {{ query?: Record<string, string | number | boolean | undefined> }} [options]
 */
function buildPlaneUrl(path, options = {}) {
  const { baseUrl } = getPlaneConfig();
  const url = new URL(path, `${baseUrl}/`);

  const query = options.query ?? {};
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  return url;
}

/**
 * @param {URL} url
 */
async function doPlaneFetch(url) {
  const { apiKey } = getPlaneConfig();
  const res = await fetch(url, {
    method: "GET",
    headers: buildPlaneHeaders(apiKey),
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    throw new PlaneApiError(
      `Plane API ${res.status} ${res.statusText} for ${url.pathname}`,
      res.status,
      parsed
    );
  }

  return parsed;
}

/**
 * @param {string[]} paths
 * @param {{ query?: Record<string, string | number | boolean | undefined> }} [options]
 */
async function requestPlaneWithFallback(paths, options = {}) {
  /** @type {Array<string>} */
  const failures = [];

  for (const path of paths) {
    try {
      const url = buildPlaneUrl(path, options);
      const payload = await doPlaneFetch(url);
      return { payload, resolvedPath: path };
    } catch (error) {
      if (error instanceof PlaneApiError && (error.status === 404 || error.status === 405)) {
        failures.push(`${path} -> ${error.status}`);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Plane endpoint resolution failed (${failures.join(", ") || "no candidate path worked"})`);
}

/**
 * @param {unknown} payload
 * @returns {{ items: any[], next: string | null, nextCursor: string | null }}
 */
function normalizePaginatedPayload(payload) {
  if (Array.isArray(payload)) {
    return { items: payload, next: null, nextCursor: null };
  }

  if (!payload || typeof payload !== "object") {
    return { items: [], next: null, nextCursor: null };
  }

  if (Array.isArray(payload.results)) {
    return {
      items: payload.results,
      next: typeof payload.next === "string" ? payload.next : null,
      nextCursor: typeof payload.next_cursor === "string" ? payload.next_cursor : null,
    };
  }

  if (Array.isArray(payload.data)) {
    return {
      items: payload.data,
      next:
        typeof payload.next === "string"
          ? payload.next
          : typeof payload.next_page_url === "string"
            ? payload.next_page_url
            : null,
      nextCursor: typeof payload.next_cursor === "string" ? payload.next_cursor : null,
    };
  }

  return { items: [], next: null, nextCursor: null };
}

/**
 * @param {string[]} paths
 * @param {{ query?: Record<string, string | number | boolean | undefined> }} [options]
 */
async function fetchAllPlanePages(paths, options = {}) {
  /** @type {any[]} */
  const aggregated = [];

  let { payload, resolvedPath } = await requestPlaneWithFallback(paths, options);
  const baseQuery = { ...(options.query ?? {}) };

  while (true) {
    const { items, next, nextCursor } = normalizePaginatedPayload(payload);
    aggregated.push(...items);

    if (next) {
      const nextUrl = next.startsWith("http") ? new URL(next) : buildPlaneUrl(next);
      payload = await doPlaneFetch(nextUrl);
      continue;
    }

    if (nextCursor) {
      const cursorUrl = buildPlaneUrl(resolvedPath, {
        query: { ...baseQuery, cursor: nextCursor },
      });
      payload = await doPlaneFetch(cursorUrl);
      continue;
    }

    break;
  }

  return aggregated;
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @param {string[]} out
 */
function collectStringValues(value, depth, out) {
  if (depth < 0 || value == null) return;

  if (typeof value === "string") {
    out.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, depth - 1, out);
    return;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) collectStringValues(item, depth - 1, out);
  }
}

/**
 * @param {unknown} issue
 * @returns {string}
 */
function getIssueDisplayId(issue) {
  if (!issue || typeof issue !== "object") return "unknown-ticket";

  const identifier = issue.identifier ?? issue.issue_identifier;
  if (typeof identifier === "string" && identifier.trim()) return identifier.trim();

  const projectIdentifier =
    typeof issue.project_identifier === "string"
      ? issue.project_identifier
      : typeof issue.project?.identifier === "string"
        ? issue.project.identifier
        : "";

  const sequenceId = issue.sequence_id ?? issue.sequenceId;
  if (projectIdentifier && sequenceId != null) return `${projectIdentifier}-${sequenceId}`;
  if (sequenceId != null) return `#${sequenceId}`;

  return String(issue.id ?? "unknown-ticket");
}

/**
 * @param {unknown} issue
 * @returns {string}
 */
function getIssueTitle(issue) {
  if (!issue || typeof issue !== "object") return "Untitled";
  if (typeof issue.name === "string" && issue.name.trim()) return issue.name;
  if (typeof issue.title === "string" && issue.title.trim()) return issue.title;
  return "Untitled";
}

/**
 * @param {unknown} issue
 * @returns {string | null}
 */
function getIssueStateId(issue) {
  if (!issue || typeof issue !== "object") return null;

  if (typeof issue.state_id === "string") return issue.state_id;
  if (typeof issue.state_id === "number") return String(issue.state_id);
  if (typeof issue.state === "string") return issue.state;
  if (typeof issue.state === "number") return String(issue.state);
  if (issue.state && typeof issue.state === "object" && typeof issue.state.id === "string") return issue.state.id;
  if (issue.state && typeof issue.state === "object" && typeof issue.state.id === "number") return String(issue.state.id);

  return null;
}

/**
 * @param {unknown[]} links
 * @returns {{ url: string, owner: string, repo: string, prNumber: string } | null}
 */
function extractGithubPrFromLinks(links) {
  for (const link of links) {
    /** @type {string[]} */
    const values = [];
    collectStringValues(link, 3, values);

    for (const value of values) {
      const match = value.match(GITHUB_PR_REGEX);
      if (!match) continue;

      return {
        url: value.trim(),
        owner: match[1],
        repo: match[2],
        prNumber: match[3],
      };
    }
  }

  return null;
}

/**
 * @param {string} projectId
 * @param {string} issueId
 */
async function listIssueLinks(projectId, issueId) {
  const { workspaceSlug } = getPlaneConfig();
  const base = `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}`;

  return fetchAllPlanePages([
    `${base}/issues/${issueId}/links/`,
    `${base}/issues/${issueId}/links`,
    `${base}/work-items/${issueId}/links/`,
    `${base}/work-items/${issueId}/links`,
  ]);
}

/**
 * @param {unknown} issue
 * @returns {unknown[]}
 */
function getInlineIssueLinks(issue) {
  if (!issue || typeof issue !== "object") return [];

  const candidates = [issue.links, issue.issue_links, issue.external_links, issue.link_details];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

/** @returns {Promise<Array<{ projectId: string, projectName: string, projectIdentifier: string, moduleId: string, moduleName: string }>>} */
export async function fetchPlaneModules() {
  const { workspaceSlug, scopedProjectIds } = getPlaneConfig();
  const projectBase = `/api/v1/workspaces/${workspaceSlug}/projects`;

  const projects = await fetchAllPlanePages([`${projectBase}/`, `${projectBase}`]);

  let projectRows = projects
    .map((project) => ({
      projectId: String(project.id || ""),
      projectName: String(project.name || ""),
      projectIdentifier: String(project.identifier || ""),
    }))
    .filter((project) => project.projectId && project.projectName);

  if (scopedProjectIds.length > 0) {
    const scoped = new Set(scopedProjectIds);
    projectRows = projectRows.filter((project) => scoped.has(project.projectId));
  }

  const moduleRows = await Promise.all(
    projectRows.map(async (project) => {
      let modules = [];
      try {
        modules = await fetchAllPlanePages([
          `${projectBase}/${project.projectId}/modules/`,
          `${projectBase}/${project.projectId}/modules`,
        ]);
      } catch (error) {
        if (error instanceof PlaneApiError && error.status === 403) {
          console.warn(
            `[test-staging] Skipping project ${project.projectId} (${project.projectName}) while listing modules: 403 Forbidden`
          );
          return [];
        }
        throw error;
      }

      return modules
        .map((module) => ({
          projectId: project.projectId,
          projectName: project.projectName,
          projectIdentifier: project.projectIdentifier,
          moduleId: String(module.id || ""),
          moduleName: String(module.name || module.title || ""),
        }))
        .filter((module) => module.moduleId && module.moduleName);
    })
  );

  return moduleRows
    .flat()
    .sort((a, b) => `${a.projectName}/${a.moduleName}`.localeCompare(`${b.projectName}/${b.moduleName}`));
}

/**
 * @param {string} projectId
 * @returns {Promise<Array<{ id: string, name: string, color?: string }>>}
 */
export async function fetchPlaneStates(projectId) {
  const { workspaceSlug } = getPlaneConfig();
  const base = `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/states`;

  const states = await fetchAllPlanePages([`${base}/`, `${base}`]);
  return states
    .map((state) => ({
      id: String(state.id || ""),
      name: String(state.name || ""),
      color: typeof state.color === "string" ? state.color : undefined,
    }))
    .filter((state) => state.id && state.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {simpleGit.SimpleGit} git
 */
async function resolveBaseBranch(git) {
  const forced = String(process.env.TEST_STAGING_BASE_BRANCH || "").trim();
  if (forced) return forced;

  try {
    const ref = (await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]))
      .trim()
      .replace("refs/remotes/origin/", "");
    if (ref) return ref;
  } catch {}

  try {
    const local = await git.branchLocal();
    if (local.current) return local.current;
  } catch {}

  return "master";
}

/**
 * @param {string} envId
 * @param {string} line
 */
function appendLog(envId, line) {
  testStagingState.log.push(line);
  console.log(`[test-staging:${envId}] ${line}`);
}

/**
 * @param {string} envId
 * @param {string} projectId
 * @param {string} moduleId
 * @param {string[]} statusIds
 */
async function runTestStaging(envId, projectId, moduleId, statusIds) {
  const env = getEnvs()[envId];
  const git = simpleGit(env.repoPath);

  appendLog(envId, `Fetching module work items from Plane (module: ${moduleId})...`);

  const { workspaceSlug } = getPlaneConfig();
  const moduleItems = await fetchAllPlanePages([
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/module-issues/`,
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/module-issues`,
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/issues/`,
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/issues`,
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/work-items/`,
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/work-items`,
  ]);

  const selectedStatusSet = new Set(statusIds);
  const filteredItems = selectedStatusSet.size > 0
    ? moduleItems.filter((item) => {
      const stateId = getIssueStateId(item);
      return !!stateId && selectedStatusSet.has(stateId);
    })
    : moduleItems;

  appendLog(envId, `Fetched ${moduleItems.length} ticket(s) from module. Using ${filteredItems.length} ticket(s) after status filter.`);

  /** @type {Array<{ ticketId: string, ticketTitle: string, prNumber: string, prUrl: string, localBranch: string }>} */
  const mergePlan = [];

  for (const item of filteredItems) {
    const ticketId = getIssueDisplayId(item);
    const ticketTitle = getIssueTitle(item);
    const issueId = String(item.id || "").trim();

    if (!issueId) {
      throw new Error(`Ticket ${ticketId} is missing internal id from Plane response`);
    }

    let pr = extractGithubPrFromLinks(getInlineIssueLinks(item));

    if (!pr) {
      const links = await listIssueLinks(projectId, issueId);
      pr = extractGithubPrFromLinks(links);
    }

    if (!pr) {
      throw new Error(`Ticket ${ticketId} is missing GitHub PR link`);
    }

    const localBranch = `ts-pr-${pr.prNumber}`;
    appendLog(envId, `Ticket ${ticketId} (${ticketTitle}) -> PR #${pr.prNumber}`);
    mergePlan.push({
      ticketId,
      ticketTitle,
      prNumber: pr.prNumber,
      prUrl: pr.url,
      localBranch,
    });
  }

  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const baseBranch = await resolveBaseBranch(git);
  const stagingBranch = `test-staging/${envId}/${timestamp}`;

  appendLog(envId, `Preparing repository at ${env.repoPath}`);
  appendLog(envId, `Base branch: ${baseBranch}`);

  await git.fetch(["--prune"]);
  await git.reset(["--hard"]);
  await git.clean("f", ["-d"]);
  await git.checkout(baseBranch);
  await git.pull("origin", baseBranch, ["--ff-only"]);
  await git.checkoutLocalBranch(stagingBranch);

  appendLog(envId, `Created staging branch: ${stagingBranch}`);

  /** @type {Array<{ ticketId: string, localBranch: string, prNumber: string, reason: string }>} */
  const conflicts = [];
  /** @type {Array<{ ticketId: string, localBranch: string, prNumber: string }>} */
  const merged = [];

  for (const target of mergePlan) {
    appendLog(envId, `Fetching PR #${target.prNumber} into ${target.localBranch}`);
    await git.fetch(["origin", `pull/${target.prNumber}/head:${target.localBranch}`]);

    try {
      appendLog(envId, `Merging ${target.localBranch} into ${stagingBranch}`);
      await git.raw(["merge", "--no-ff", "--no-edit", target.localBranch]);
      appendLog(envId, `Merged ${target.localBranch} (${target.ticketId})`);
      merged.push({ ticketId: target.ticketId, localBranch: target.localBranch, prNumber: target.prNumber });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      appendLog(envId, `Merge conflict in ${target.localBranch} (${target.ticketId}). Aborting this merge for manual resolution.`);

      try {
        await git.raw(["merge", "--abort"]);
        appendLog(envId, `Merge abort completed for ${target.localBranch}`);
      } catch {
        appendLog(envId, `Merge abort not required or failed for ${target.localBranch}`);
      }

      conflicts.push({
        ticketId: target.ticketId,
        localBranch: target.localBranch,
        prNumber: target.prNumber,
        reason,
      });
    }
  }

  appendLog(envId, "Test staging merge process finished.");
  appendLog(envId, `Merged branches: ${merged.length}`);

  if (conflicts.length > 0) {
    appendLog(envId, `Conflicted branches (${conflicts.length}) for manual resolution:`);
    for (const conflict of conflicts) {
      appendLog(envId, `  - ${conflict.localBranch} (${conflict.ticketId})`);
    }
  }

  appendLog(envId, `Current branch: ${stagingBranch}`);

  testStagingState.meta = {
    envId,
    projectId,
    moduleId,
    statusIds,
    stagingBranch,
    mergedCount: merged.length,
    conflictedCount: conflicts.length,
    conflictedBranches: conflicts.map((conflict) => conflict.localBranch),
  };
}

/**
 * @param {{ envId: string, projectId: string, moduleId: string, statusIds?: string[] }} input
 */
export function startTestStagingRun(input) {
  if (testStagingState.status === "running") {
    const error = new Error("Test staging is already running");
    error.code = "RUNNING";
    throw error;
  }

  const { envId, projectId, moduleId } = input;
  const statusIds = [...new Set((input.statusIds || []).map((statusId) => String(statusId || "").trim()).filter(Boolean))];

  testStagingState.status = "running";
  testStagingState.log = [];
  testStagingState.startedAt = new Date().toISOString();
  testStagingState.finishedAt = null;
  testStagingState.meta = {
    envId,
    projectId,
    moduleId,
    statusIds,
    stagingBranch: null,
    mergedCount: 0,
    conflictedCount: 0,
    conflictedBranches: [],
  };

  appendLog(envId, "Starting test staging workflow...");
  if (statusIds.length > 0) appendLog(envId, `Status filters: ${statusIds.join(", ")}`);

  runTestStaging(envId, projectId, moduleId, statusIds)
    .then(() => {
      testStagingState.status = "success";
      testStagingState.finishedAt = new Date().toISOString();
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(envId, `Error: ${message}`);
      testStagingState.status = "error";
      testStagingState.finishedAt = new Date().toISOString();
    });
}
