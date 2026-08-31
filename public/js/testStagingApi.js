import { api } from "./api.js";

export async function getTestStagingModules({ search = "", cursor = "", limit = 25 } = {}) {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (cursor) query.set("cursor", cursor);
  if (Number.isFinite(limit) && limit > 0) query.set("limit", String(limit));
  const queryString = query.toString();
  return api("GET", `/api/test-staging/modules${queryString ? `?${queryString}` : ""}`);
}

export async function getTestStagingPreferences() {
  return api("GET", "/api/test-staging/preferences");
}

export async function saveTestStagingSelectedModule(payload) {
  return api("POST", "/api/test-staging/selected-module", payload);
}

export async function getTestStagingStates(projectId) {
  const query = new URLSearchParams({ projectId });
  return api("GET", `/api/test-staging/states?${query.toString()}`);
}

export async function startTestStaging(payload) {
  return api("POST", "/api/test-staging/start", payload);
}

export async function getTestStagingLog() {
  return api("GET", "/api/test-staging/log");
}

export async function getTestStagingPlaneRequests(limit = 120) {
  const query = new URLSearchParams();
  if (Number.isFinite(limit) && limit > 0) query.set("limit", String(limit));
  return api("GET", `/api/test-staging/plane-requests${query.toString() ? `?${query.toString()}` : ""}`);
}
