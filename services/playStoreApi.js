const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

/**
 * @param {string} accessToken
 * @param {string} packageName
 * @returns {Promise<string>} editId
 */
export async function createEditSession(accessToken, packageName) {
  const res = await fetch(`${BASE}/${packageName}/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`createEditSession failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

/**
 * @param {string} accessToken
 * @param {string} packageName
 * @param {string} editId
 * @param {string} aabPath
 * @returns {Promise<number>} versionCode
 */
export async function uploadAAB(accessToken, packageName, editId, aabPath) {
  const { readFileSync } = await import("fs");
  const aabBuffer = readFileSync(aabPath);
  const res = await fetch(
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${packageName}/edits/${editId}/bundles`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: aabBuffer,
    }
  );
  if (!res.ok) throw new Error(`uploadAAB failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.versionCode;
}

/**
 * @param {string} accessToken
 * @param {string} packageName
 * @param {string} editId
 * @param {number} versionCode
 * @param {{ track: string, releaseName: string, userFraction: number, releaseNotes: string }} opts
 */
export async function updateTrack(accessToken, packageName, editId, versionCode, opts) {
  const { track, releaseName, userFraction, releaseNotes } = opts;
  const isFullRollout = userFraction >= 1;

  const release = {
    name: releaseName,
    versionCodes: [String(versionCode)],
    status: isFullRollout ? "completed" : "inProgress",
    releaseNotes: [{ language: "en-US", text: releaseNotes }],
    ...(isFullRollout ? {} : { userFraction }),
  };

  const res = await fetch(`${BASE}/${packageName}/edits/${editId}/tracks/${track}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ track, releases: [release] }),
  });
  if (!res.ok) throw new Error(`updateTrack failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/**
 * @param {string} accessToken
 * @param {string} packageName
 * @param {string} editId
 */
export async function commitEdit(accessToken, packageName, editId) {
  const res = await fetch(`${BASE}/${packageName}/edits/${editId}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`commitEdit failed (${res.status}): ${await res.text()}`);
  return res.json();
}
