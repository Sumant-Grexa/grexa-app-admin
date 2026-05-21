import { readFileSync } from "fs";
import { playStoreConfig } from "../config/playStore.js";
import { getAccessToken } from "./googleAuth.js";

const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

/** @type {{ status: 'idle'|'running'|'success'|'error', log: string[], startedAt: string|null, finishedAt: string|null, versionCode: number|null, editId: string|null }} */
export const releaseState = {
  status: "idle",
  log: [],
  startedAt: null,
  finishedAt: null,
  versionCode: null,
  editId: null,
};

/** @param {Partial<typeof releaseState>} patch */
function setState(patch) {
  Object.assign(releaseState, patch);
}

/** @param {string} line */
function append(line) {
  releaseState.log.push(line);
  console.log(`[play-store] ${line}`);
}

/**
 * @param {string} accessToken
 * @returns {Promise<string>} editId
 */
async function createEditSession(accessToken) {
  const res = await fetch(`${BASE}/${playStoreConfig.packageName}/edits`, {
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
 * @param {string} editId
 * @returns {Promise<number>} versionCode
 */
async function uploadAAB(accessToken, editId) {
  const aabBuffer = readFileSync(playStoreConfig.aabPath);
  const res = await fetch(
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${playStoreConfig.packageName}/edits/${editId}/bundles`,
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
 * @param {string} editId
 * @param {number} versionCode
 * @param {{ track: string, releaseName: string, userFraction: number, releaseNotes: string }} options
 */
async function updateTrack(accessToken, editId, versionCode, options) {
  const { track, releaseName, userFraction, releaseNotes } = options;

  // userFraction=1 means full rollout → use status "completed" with no fraction
  const isFullRollout = userFraction >= 1;
  const release = {
    name: releaseName,
    versionCodes: [String(versionCode)],
    status: isFullRollout ? "completed" : "inProgress",
    releaseNotes: [{ language: "en-US", text: releaseNotes }],
    ...(isFullRollout ? {} : { userFraction }),
  };

  const res = await fetch(
    `${BASE}/${playStoreConfig.packageName}/edits/${editId}/tracks/${track}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ track, releases: [release] }),
    }
  );
  if (!res.ok) throw new Error(`updateTrack failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/**
 * @param {string} accessToken
 * @param {string} editId
 */
async function commitEdit(accessToken, editId) {
  const res = await fetch(
    `${BASE}/${playStoreConfig.packageName}/edits/${editId}:commit`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) throw new Error(`commitEdit failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/**
 * @param {{ track: string, releaseName: string, userFraction: number, releaseNotes: string }} options
 */
export async function runRelease(options) {
  setState({
    status: "running",
    log: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    versionCode: null,
    editId: null,
  });

  let accessToken, editId, versionCode, commitResponse;

  try {
    append("Obtaining access token...");
    accessToken = await getAccessToken(playStoreConfig.serviceAccount);
    append("Access token obtained.");

    append("Creating edit session...");
    editId = await createEditSession(accessToken);
    setState({ editId });
    append(`Edit session created. editId=${editId}`);

    append(`Uploading AAB from ${playStoreConfig.aabPath}...`);
    versionCode = await uploadAAB(accessToken, editId);
    setState({ versionCode });
    append(`AAB uploaded. versionCode=${versionCode}`);

    append(`Updating track "${options.track}"...`);
    await updateTrack(accessToken, editId, versionCode, options);
    append("Track updated.");

    append("Committing edit...");
    commitResponse = await commitEdit(accessToken, editId);
    append("Edit committed. Release is live.");

    setState({ status: "success", finishedAt: new Date().toISOString() });
    return { editId, versionCode, commitResponse };
  } catch (err) {
    append(`Error: ${err instanceof Error ? err.message : String(err)}`);
    setState({ status: "error", finishedAt: new Date().toISOString() });
    throw err;
  }
}
