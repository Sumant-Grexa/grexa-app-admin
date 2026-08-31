import simpleGit from "simple-git";
import { randomUUID } from "crypto";
import { getEnvs } from "../config/environments.js";

const GITHUB_PR_REGEX = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;
const DEFAULT_MODULE_PAGE_SIZE = 25;
const MAX_MODULE_PAGE_SIZE = 100;
const MODULE_BROWSE_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PLANE_REQUEST_GAP_MS = 250;
const DEFAULT_PLANE_MAX_429_RETRIES = 3;
const DEFAULT_PLANE_429_BACKOFF_MS = 1000;
const MAX_PLANE_DEBUG_EVENTS = 400;

export const testStagingState = {
  status: "idle", // 'idle' | 'running' | 'success' | 'error'
  log: [],
  startedAt: null,
  finishedAt: null,
  meta: null,
};

/** @type {Map<string, string>} */
const planeResolvedPathCache = new Map();
/** @type {Map<string, { id: string, search: string, projectIds: string[], projectIndex: number, projectNext: string | null, projectNextCursor: string | null, projectResolvedPath: string | null, buffered: Array<{ projectId: string, moduleId: string, projectName: string, moduleName: string, projectIdentifier: string }>, expiresAt: number }>} */
const moduleBrowseSessions = new Map();
/** @type {Promise<unknown>} */
let planeRequestChain = Promise.resolve();
let lastPlaneRequestAt = 0;
/** @type {Array<{ timestamp: string, url: string, path: string, status: number, statusText: string, durationMs: number, attempt: number, retryAfterMs: number | null }>} */
const planeRequestDebugEvents = [];

class PlaneApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} details
   * @param {{ url?: string, attempt?: number, retryAfterMs?: number | null }} [meta]
   */
  constructor(message, status, details, meta = {}) {
    super(message);
    this.name = "PlaneApiError";
    this.status = status;
    this.details = details;
    this.meta = meta;
  }
}

class ModuleBrowseCursorError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "ModuleBrowseCursorError";
    this.code = "INVALID_CURSOR";
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

/** @returns {number} */
function getPlaneRequestGapMs() {
  const raw = Number.parseInt(String(process.env.PLANE_REQUEST_GAP_MS || ""), 10);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_PLANE_REQUEST_GAP_MS;
}

/** @returns {number} */
function getPlaneMax429Retries() {
  const raw = Number.parseInt(String(process.env.PLANE_429_MAX_RETRIES || ""), 10);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_PLANE_MAX_429_RETRIES;
}

/** @returns {number} */
function getPlane429BackoffMs() {
  const raw = Number.parseInt(String(process.env.PLANE_429_BACKOFF_MS || ""), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_PLANE_429_BACKOFF_MS;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string | null} retryAfter
 * @returns {number | null}
 */
function parseRetryAfterMs(retryAfter) {
  if (!retryAfter) return null;

  const trimmed = retryAfter.trim();
  if (!trimmed) return null;

  const asSeconds = Number.parseFloat(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }

  const asDate = Date.parse(trimmed);
  if (!Number.isFinite(asDate)) return null;
  return Math.max(0, asDate - Date.now());
}

/**
 * @param {{ timestamp: string, url: string, path: string, status: number, statusText: string, durationMs: number, attempt: number, retryAfterMs: number | null }} event
 */
function pushPlaneDebugEvent(event) {
  planeRequestDebugEvents.push(event);
  if (planeRequestDebugEvents.length > MAX_PLANE_DEBUG_EVENTS) {
    planeRequestDebugEvents.splice(0, planeRequestDebugEvents.length - MAX_PLANE_DEBUG_EVENTS);
  }
}

/**
 * @param {number} [limit]
 * @returns {Array<{ timestamp: string, url: string, path: string, status: number, statusText: string, durationMs: number, attempt: number, retryAfterMs: number | null }>}
 */
export function getPlaneRequestDebugLog(limit = 200) {
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), MAX_PLANE_DEBUG_EVENTS) : 200;
  const start = Math.max(0, planeRequestDebugEvents.length - safeLimit);
  return planeRequestDebugEvents.slice(start).map((event) => ({ ...event }));
}

export function clearPlaneRequestDebugLog() {
  planeRequestDebugEvents.splice(0, planeRequestDebugEvents.length);
}

/**
 * @param {unknown} module
 * @returns {{ projectId: string, moduleId: string, projectName: string, moduleName: string, projectIdentifier: string } | null}
 */
function normalizeModuleRecord(module) {
  if (!module || typeof module !== "object") return null;

  const projectId = String(module.projectId || "").trim();
  const moduleId = String(module.moduleId || "").trim();
  const projectName = String(module.projectName || "").trim();
  const moduleName = String(module.moduleName || "").trim();
  const projectIdentifier = String(module.projectIdentifier || "").trim();

  if (!projectId || !moduleId || !projectName || !moduleName) return null;

  return {
    projectId,
    moduleId,
    projectName,
    moduleName,
    projectIdentifier,
  };
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
  const run = async () => {
    const { apiKey } = getPlaneConfig();
    const max429Retries = getPlaneMax429Retries();
    const baseBackoffMs = getPlane429BackoffMs();

    for (let attempt = 1; attempt <= max429Retries + 1; attempt += 1) {
      const gapMs = getPlaneRequestGapMs();
      const waitForGap = Math.max(0, gapMs - (Date.now() - lastPlaneRequestAt));
      if (waitForGap > 0) {
        await sleep(waitForGap);
      }

      const startedAt = Date.now();
      const res = await fetch(url, {
        method: "GET",
        headers: buildPlaneHeaders(apiKey),
      });
      const finishedAt = Date.now();
      lastPlaneRequestAt = finishedAt;

      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }

      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      pushPlaneDebugEvent({
        timestamp: new Date(finishedAt).toISOString(),
        url: url.toString(),
        path: `${url.pathname}${url.search}`,
        status: res.status,
        statusText: res.statusText,
        durationMs: Math.max(0, finishedAt - startedAt),
        attempt,
        retryAfterMs,
      });

      if (res.status === 429 && attempt <= max429Retries) {
        const retryDelay = retryAfterMs ?? Math.max(100, baseBackoffMs * (2 ** (attempt - 1)));
        await sleep(retryDelay);
        continue;
      }

      if (!res.ok) {
        throw new PlaneApiError(
          `Plane API ${res.status} ${res.statusText} for ${url.pathname}${attempt > 1 ? ` after ${attempt} attempts` : ""}`,
          res.status,
          parsed,
          { url: url.toString(), attempt, retryAfterMs }
        );
      }

      return parsed;
    }

    throw new PlaneApiError(
      `Plane API 429 Too Many Requests for ${url.pathname} after retry exhaustion`,
      429,
      null,
      { url: url.toString(), attempt: max429Retries + 1, retryAfterMs: null }
    );
  };

  const scheduledRun = planeRequestChain.then(run, run);
  planeRequestChain = scheduledRun.catch(() => {});
  return scheduledRun;
}

/**
 * @param {string[]} paths
 * @param {{ query?: Record<string, string | number | boolean | undefined> }} [options]
 */
async function requestPlaneWithFallback(paths, options = {}) {
  /** @type {Array<string>} */
  const failures = [];
  const cacheKey = paths.join("|");
  const preferredPath = planeResolvedPathCache.get(cacheKey);
  const orderedPaths = preferredPath
    ? [preferredPath, ...paths.filter((path) => path !== preferredPath)]
    : paths;

  for (const path of orderedPaths) {
    try {
      const url = buildPlaneUrl(path, options);
      const payload = await doPlaneFetch(url);
      planeResolvedPathCache.set(cacheKey, path);
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
 * @param {string} search
 * @returns {string}
 */
function normalizeModuleSearch(search) {
  return String(search || "").trim();
}

/**
 * @param {{ projectId: string, moduleId: string, projectName: string, moduleName: string, projectIdentifier?: string }} module
 * @param {string} normalizedSearch
 * @returns {boolean}
 */
function moduleMatchesSearch(module, normalizedSearch) {
  if (!normalizedSearch) return true;
  const searchable = `${module.projectName} ${module.moduleName} ${module.projectIdentifier || ""}`.toLowerCase();
  return searchable.includes(normalizedSearch);
}

function pruneModuleBrowseSessions() {
  const now = Date.now();
  for (const [cursor, session] of moduleBrowseSessions.entries()) {
    if (session.expiresAt <= now) {
      moduleBrowseSessions.delete(cursor);
    }
  }
}

/**
 * @param {string} nextPath
 * @returns {URL}
 */
function resolvePlaneNextUrl(nextPath) {
  return nextPath.startsWith("http") ? new URL(nextPath) : buildPlaneUrl(nextPath);
}

/**
 * @param {string | null} next
 * @returns {string | null}
 */
function extractPlaneCursor(next) {
  if (!next) return null;
  try {
    const url = next.startsWith("http") ? new URL(next) : buildPlaneUrl(next);
    const cursor = String(url.searchParams.get("cursor") || "").trim();
    return cursor || null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} module
 * @param {{ projectId?: string, projectName?: string, projectIdentifier?: string }} [fallback]
 * @returns {{ projectId: string, moduleId: string, projectName: string, moduleName: string, projectIdentifier: string } | null}
 */
function normalizePlaneModuleRecord(module, fallback = {}) {
  if (!module || typeof module !== "object") return null;

  const project =
    module.project && typeof module.project === "object"
      ? module.project
      : module.project_detail && typeof module.project_detail === "object"
        ? module.project_detail
        : null;

  return normalizeModuleRecord({
    projectId: String(module.project_id || module.projectId || project?.id || fallback.projectId || "").trim(),
    moduleId: String(module.id || module.module_id || module.moduleId || "").trim(),
    projectName: String(module.project_name || module.projectName || project?.name || fallback.projectName || fallback.projectId || "").trim(),
    moduleName: String(module.name || module.title || module.module_name || module.moduleName || "").trim(),
    projectIdentifier: String(
      module.project_identifier || module.projectIdentifier || project?.identifier || fallback.projectIdentifier || ""
    ).trim(),
  });
}

/**
 * @param {{ limit: number, search: string, cursor: string }} input
 * @returns {Promise<{ modules: Array<{ projectId: string, projectName: string, projectIdentifier: string, moduleId: string, moduleName: string }>, nextCursor: string | null, hasMore: boolean }>}
 */
async function fetchWorkspaceModulesPage(input) {
  const { workspaceSlug, scopedProjectIds } = getPlaneConfig();
  const query = { limit: input.limit };
  if (input.cursor) query.cursor = input.cursor;
  if (input.search) query.search = input.search;

  const payload = await doPlaneFetch(
    buildPlaneUrl(`/api/v1/workspaces/${workspaceSlug}/modules/`, {
      query,
    })
  );

  const page = normalizePaginatedPayload(payload);
  const scopedProjectSet = scopedProjectIds.length > 0 ? new Set(scopedProjectIds) : null;
  const modules = page.items
    .map((module) => normalizePlaneModuleRecord(module))
    .filter(Boolean)
    .filter((module) => {
      if (!scopedProjectSet) return true;
      return scopedProjectSet.has(module.projectId);
    });

  const nextCursor = String(page.nextCursor || extractPlaneCursor(page.next) || "").trim() || null;
  return {
    modules,
    nextCursor,
    hasMore: Boolean(nextCursor),
  };
}

/**
 * @param {string} projectId
 * @param {{ projectNext: string | null, projectNextCursor: string | null, projectResolvedPath: string | null, search: string }} session
 * @returns {Promise<{ items: any[], next: string | null, nextCursor: string | null, resolvedPath: string | null }>}
 */
async function fetchScopedProjectModulesPage(projectId, session) {
  const { workspaceSlug } = getPlaneConfig();
  const projectBase = `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/modules`;

  if (session.projectNext) {
    const payload = await doPlaneFetch(resolvePlaneNextUrl(session.projectNext));
    const normalized = normalizePaginatedPayload(payload);
    return { ...normalized, resolvedPath: session.projectResolvedPath };
  }

  if (session.projectNextCursor && session.projectResolvedPath) {
    const payload = await doPlaneFetch(
      buildPlaneUrl(session.projectResolvedPath, {
        query: {
          cursor: session.projectNextCursor,
          ...(session.search ? { search: session.search } : {}),
        },
      })
    );
    const normalized = normalizePaginatedPayload(payload);
    return { ...normalized, resolvedPath: session.projectResolvedPath };
  }

  const { payload, resolvedPath } = await requestPlaneWithFallback(
    [`${projectBase}/`, `${projectBase}`],
    { query: session.search ? { search: session.search } : undefined }
  );

  const normalized = normalizePaginatedPayload(payload);
  return { ...normalized, resolvedPath };
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

/**
 * @param {{ cursor?: string, search?: string, limit?: number, forceRefresh?: boolean }} [input]
 * @returns {Promise<{ modules: Array<{ projectId: string, projectName: string, projectIdentifier: string, moduleId: string, moduleName: string }>, nextCursor: string | null, hasMore: boolean }>}
 */
export async function fetchPlaneModulesPage(input = {}) {
  const cursor = String(input.cursor || "").trim();
  const search = normalizeModuleSearch(input.search || "");
  const searchLower = search.toLowerCase();
  const rawLimit = Number.parseInt(String(input.limit ?? DEFAULT_MODULE_PAGE_SIZE), 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_MODULE_PAGE_SIZE, Math.max(1, rawLimit))
    : DEFAULT_MODULE_PAGE_SIZE;

  pruneModuleBrowseSessions();

  try {
    return await fetchWorkspaceModulesPage({
      limit,
      search,
      cursor,
    });
  } catch (error) {
    if (error instanceof PlaneApiError && error.status === 429) {
      throw new Error("Plane API rate limit hit while loading modules page (429). Retry shortly.");
    }
    if (!(error instanceof PlaneApiError) || (error.status !== 404 && error.status !== 405)) {
      throw error;
    }
  }

  const { scopedProjectIds } = getPlaneConfig();
  if (scopedProjectIds.length === 0) {
    throw new Error(
      "Plane workspace modules endpoint is unavailable (404). Configure PLANE_TEST_STAGING_PROJECT_IDS to enable project-scoped module pagination."
    );
  }

  /** @type {{ id: string, search: string, projectIds: string[], projectIndex: number, projectNext: string | null, projectNextCursor: string | null, projectResolvedPath: string | null, buffered: Array<{ projectId: string, moduleId: string, projectName: string, moduleName: string, projectIdentifier: string }>, expiresAt: number }} */
  let session;

  if (!cursor) {
    session = {
      id: randomUUID(),
      search,
      projectIds: [...new Set(scopedProjectIds)],
      projectIndex: 0,
      projectNext: null,
      projectNextCursor: null,
      projectResolvedPath: null,
      buffered: [],
      expiresAt: Date.now() + MODULE_BROWSE_SESSION_TTL_MS,
    };
    moduleBrowseSessions.set(session.id, session);
  } else {
    const existing = moduleBrowseSessions.get(cursor);
    if (!existing) {
      throw new ModuleBrowseCursorError("Module pagination cursor expired. Reopen the dropdown and search again.");
    }
    if (String(existing.search || "").toLowerCase() !== searchLower) {
      throw new ModuleBrowseCursorError("Module pagination cursor does not match current search.");
    }
    existing.expiresAt = Date.now() + MODULE_BROWSE_SESSION_TTL_MS;
    session = existing;
  }

  /** @type {Array<{ projectId: string, projectName: string, projectIdentifier: string, moduleId: string, moduleName: string }>} */
  const modules = [];

  while (modules.length < limit) {
    if (session.buffered.length > 0) {
      const bufferedItem = session.buffered.shift();
      if (bufferedItem) modules.push(bufferedItem);
      continue;
    }

    if (session.projectIndex >= session.projectIds.length) break;
    const projectId = session.projectIds[session.projectIndex];

    let page;
    try {
      page = await fetchScopedProjectModulesPage(projectId, session);
    } catch (error) {
      if (error instanceof PlaneApiError && error.status === 403) {
        session.projectIndex += 1;
        session.projectNext = null;
        session.projectNextCursor = null;
        session.projectResolvedPath = null;
        continue;
      }
      if (error instanceof PlaneApiError && error.status === 429) {
        throw new Error("Plane API rate limit hit while loading modules page (429). Retry shortly.");
      }
      throw error;
    }

    const pageModules = page.items
      .map((module) =>
        normalizePlaneModuleRecord(module, {
          projectId,
          projectName: projectId,
          projectIdentifier: "",
        })
      )
      .filter(Boolean)
      .filter((module) => moduleMatchesSearch(module, searchLower));

    if (pageModules.length > 0) session.buffered.push(...pageModules);

    session.projectNext = page.next;
    session.projectNextCursor = page.nextCursor || extractPlaneCursor(page.next);
    session.projectResolvedPath = page.resolvedPath || session.projectResolvedPath;

    if (!session.projectNext && !session.projectNextCursor) {
      session.projectIndex += 1;
      session.projectNext = null;
      session.projectNextCursor = null;
      session.projectResolvedPath = null;
    }
  }

  const hasMore =
    session.buffered.length > 0 ||
    session.projectIndex < session.projectIds.length ||
    !!session.projectNext ||
    !!session.projectNextCursor;

  if (!hasMore) {
    moduleBrowseSessions.delete(session.id);
  } else {
    session.expiresAt = Date.now() + MODULE_BROWSE_SESSION_TTL_MS;
  }

  return {
    modules,
    nextCursor: hasMore ? session.id : null,
    hasMore,
  };
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
