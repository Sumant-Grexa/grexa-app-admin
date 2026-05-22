const BASE = "https://api.appstoreconnect.apple.com/v1";

async function ascFetch(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.errors?.[0]?.detail ?? err.errors?.[0]?.title ?? res.statusText;
    throw new Error(`ASC ${method} ${path} → ${res.status}: ${detail}`);
  }

  return res.status === 204 ? null : res.json();
}

/**
 * Polls until a build with the given version is VALID, then returns its ID.
 * @param {string} token
 * @param {string} appId
 * @param {string} buildVersion  the CFBundleShortVersionString (e.g. "2.1.0")
 * @param {{ maxAttempts?: number, intervalMs?: number }} opts
 * @returns {Promise<string>} buildId
 */
export async function pollForValidBuild(token, appId, buildVersion, { maxAttempts = 40, intervalMs = 60_000 } = {}) {
  for (let i = 1; i <= maxAttempts; i++) {
    const result = await ascFetch(
      token,
      "GET",
      `/builds?filter[app]=${appId}&filter[version]=${buildVersion}&filter[processingState]=VALID&sort=-uploadedDate&limit=1`
    );
    const buildId = result.data?.[0]?.id;
    if (buildId) return buildId;
    if (i < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Build v${buildVersion} did not become VALID after ${maxAttempts} attempts`);
}

/**
 * Creates an App Store version record.
 * @param {string} token
 * @param {string} appId
 * @param {string} versionString  e.g. "2.1.0"
 * @param {"AFTER_APPROVAL"|"MANUAL"|"SCHEDULED"} releaseType
 * @returns {Promise<string>} versionId
 */
export async function createAppStoreVersion(token, appId, versionString, releaseType) {
  const res = await ascFetch(token, "POST", "/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: { platform: "IOS", versionString, releaseType },
      relationships: {
        app: { data: { type: "apps", id: appId } },
      },
    },
  });
  return res.data.id;
}

/**
 * Creates a localization (release notes) for a version.
 * @param {string} token
 * @param {string} versionId
 * @param {string} locale  e.g. "en-US"
 * @param {string} whatsNewText
 * @returns {Promise<string>} localizationId
 */
export async function createLocalization(token, versionId, locale, whatsNewText) {
  const res = await ascFetch(token, "POST", "/appStoreVersionLocalizations", {
    data: {
      type: "appStoreVersionLocalizations",
      attributes: { locale, whatsNewText },
      relationships: {
        appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
      },
    },
  });
  return res.data.id;
}

/**
 * Links an uploaded build to a version.
 * @param {string} token
 * @param {string} versionId
 * @param {string} buildId
 * @returns {Promise<void>}
 */
export async function linkBuild(token, versionId, buildId) {
  await ascFetch(token, "PATCH", `/appStoreVersions/${versionId}`, {
    data: {
      type: "appStoreVersions",
      id: versionId,
      relationships: {
        build: { data: { type: "builds", id: buildId } },
      },
    },
  });
}

/**
 * Creates a phased release record for a version (7-day gradual rollout).
 * Must be called before submitForReview.
 * @param {string} token
 * @param {string} versionId
 * @returns {Promise<string>} phasedReleaseId
 */
export async function createPhasedRelease(token, versionId) {
  const res = await ascFetch(token, "POST", "/appStoreVersionPhasedReleases", {
    data: {
      type: "appStoreVersionPhasedReleases",
      attributes: { phasedReleaseState: "ACTIVE" },
      relationships: {
        appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
      },
    },
  });
  return res.data.id;
}

/**
 * Submits a version for App Store review.
 * @param {string} token
 * @param {string} versionId
 * @returns {Promise<string>} submissionId
 */
export async function submitForReview(token, versionId) {
  const res = await ascFetch(token, "POST", "/appStoreVersionSubmissions", {
    data: {
      type: "appStoreVersionSubmissions",
      relationships: {
        appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
      },
    },
  });
  return res.data.id;
}

/**
 * Triggers an immediate release for a version in PENDING_DEVELOPER_RELEASE state.
 * Call this as a separate post-approval action — not during the main pipeline.
 * @param {string} token
 * @param {string} versionId
 * @returns {Promise<void>}
 */
export async function triggerManualRelease(token, versionId) {
  await ascFetch(token, "POST", "/appStoreVersionReleaseRequests", {
    data: {
      type: "appStoreVersionReleaseRequests",
      relationships: {
        appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
      },
    },
  });
}
