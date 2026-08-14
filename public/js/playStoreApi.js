async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function startRelease(payload) {
  return api("POST", "/api/play-store/release", payload);
}

export async function triggerBeaconDocsSync(payload) {
  return api("POST", "/api/play-store/beacon-docs-sync", payload);
}

export async function getReleaseStatus() {
  return api("GET", "/api/play-store/status");
}

export async function getReleaseLog() {
  return api("GET", "/api/play-store/log");
}
