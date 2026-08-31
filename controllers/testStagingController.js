import { getEnvs } from "../config/environments.js";
import {
  fetchPlaneModulesPage,
  fetchPlaneStates,
  getPlaneRequestDebugLog,
  getSelectedTestStagingModule,
  getTestStagingPreferences,
  saveSelectedTestStagingModule,
  startTestStagingRun,
  testStagingState,
} from "../services/testStagingService.js";

/**
 * GET /api/test-staging/modules
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 */
export async function getTestStagingModules(_req, res) {
  try {
    const refresh = String(_req.query?.refresh || "").trim();
    const forceRefresh = refresh === "1" || refresh.toLowerCase() === "true";
    const cursor = String(_req.query?.cursor || "").trim();
    const search = String(_req.query?.search || "").trim();
    const parsedLimit = Number.parseInt(String(_req.query?.limit || ""), 10);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const page = await fetchPlaneModulesPage({ forceRefresh, cursor, search, limit });
    res.json(page);
  } catch (error) {
    if (error instanceof Error && error.code === "INVALID_CURSOR") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * GET /api/test-staging/preferences
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 */
export function getTestStagingPrefs(_req, res) {
  try {
    res.json(getTestStagingPreferences());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * POST /api/test-staging/selected-module
 * Body: { projectId: string, moduleId: string, projectName: string, moduleName: string, projectIdentifier?: string }
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export function setTestStagingSelectedModule(req, res) {
  try {
    const selectedModule = saveSelectedTestStagingModule(req.body || {});
    res.json({ selectedModule });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * GET /api/test-staging/states?projectId=...
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export async function getTestStagingStates(req, res) {
  const projectId = String(req.query.projectId || "").trim();
  if (!projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  try {
    const states = await fetchPlaneStates(projectId);
    res.json({ states });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * POST /api/test-staging/start
 * Body: { envId: string, projectId?: string, moduleId: string, statusId?: string, statusIds?: string[] }
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export function startTestStaging(req, res) {
  const envId = String(req.body?.envId || "").trim();
  let projectId = String(req.body?.projectId || "").trim();
  let moduleId = String(req.body?.moduleId || "").trim();
  const statusIdsRaw = Array.isArray(req.body?.statusIds)
    ? req.body.statusIds
    : req.body?.statusId != null
      ? [req.body.statusId]
      : [];
  const statusIds = [...new Set(statusIdsRaw.map((value) => String(value || "").trim()).filter(Boolean))];

  if (!projectId || !moduleId) {
    const selectedModule = getSelectedTestStagingModule();
    if (selectedModule) {
      if (!projectId) projectId = selectedModule.projectId;
      if (!moduleId) moduleId = selectedModule.moduleId;
    }
  }

  if (!projectId) {
    const scopedProjectIds = String(process.env.PLANE_TEST_STAGING_PROJECT_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (scopedProjectIds.length === 1) {
      projectId = scopedProjectIds[0];
    }
  }

  if (!envId) return res.status(400).json({ error: "envId is required" });
  if (!projectId) {
    return res.status(400).json({
      error: "projectId is required. Select a module once, or configure exactly one PLANE_TEST_STAGING_PROJECT_IDS value.",
    });
  }
  if (!moduleId) return res.status(400).json({ error: "moduleId is required" });

  const env = getEnvs()[envId];
  if (!env) return res.status(404).json({ error: `Unknown environment: ${envId}` });

  try {
    startTestStagingRun({ envId, projectId, moduleId, statusIds });
    return res.json({ ok: true, message: "Test staging started" });
  } catch (error) {
    if (error instanceof Error && error.code === "RUNNING") {
      return res.status(409).json({ error: error.message });
    }

    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * GET /api/test-staging/log
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 */
export function getTestStagingLog(_req, res) {
  return res.json({
    status: testStagingState.status,
    log: testStagingState.log,
    startedAt: testStagingState.startedAt,
    finishedAt: testStagingState.finishedAt,
    meta: testStagingState.meta,
  });
}

/**
 * GET /api/test-staging/plane-requests
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export function getTestStagingPlaneRequests(req, res) {
  const parsedLimit = Number.parseInt(String(req.query?.limit || ""), 10);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 200;
  return res.json({
    events: getPlaneRequestDebugLog(limit),
  });
}
