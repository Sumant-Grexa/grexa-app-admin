import { api } from "./api.js";

export async function getTestStagingModules({ search = "", cursor = "" } = {}) {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (cursor) query.set("cursor", cursor);
  const queryString = query.toString();
  return api("GET", `/api/test-staging/modules${queryString ? `?${queryString}` : ""}`);
}

export async function startTestStaging(payload) {
  return api("POST", "/api/test-staging/start", payload);
}

export async function getTestStagingLog() {
  return api("GET", "/api/test-staging/log");
}
