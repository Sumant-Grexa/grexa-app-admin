import { api } from "./api.js";

export async function getTestStagingModules() {
  return api("GET", "/api/test-staging/modules");
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
