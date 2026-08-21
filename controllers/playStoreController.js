import { releaseState, runReleasePipeline } from "../services/release/pipeline.js";
import { syncSupportAgentRagDocsToBeacon } from "../services/release/beaconDocsSync.js";
import { BEACON_API_CALL_ENABLED_IN_CODE, getReleaseConfig } from "../config/releaseConfig.js";

const RELEASE_PASSWORD = process.env.RELEASE_PASSWORD;

function startRelease(req, res) {
  const { releasePassword, version, releaseNotes, platforms, android, ios } = req.body;

  if (!RELEASE_PASSWORD || releasePassword !== RELEASE_PASSWORD) {
    return res.status(401).json({ error: "Invalid release password" });
  }

  if (releaseState.status === "running") {
    return res.status(409).json({ error: "A release is already in progress" });
  }

  if (!version) {
    return res.status(400).json({ error: "version is required" });
  }

  if (!Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: "At least one platform must be selected" });
  }

  if (platforms.includes("android")) {
    if (!android?.track) return res.status(400).json({ error: "android.track is required" });
    if (android?.userFraction == null) return res.status(400).json({ error: "android.userFraction is required" });
  }

  if (platforms.includes("ios")) {
    const valid = ["full", "phased", "manual"];
    if (!valid.includes(ios?.rolloutType)) {
      return res.status(400).json({ error: "ios.rolloutType must be 'full', 'phased', or 'manual'" });
    }
  }

  runReleasePipeline({
    version,
    releaseNotes:   releaseNotes ?? "",
    platforms,
    track:          android?.track ?? "production",
    userFraction:   Number(android?.userFraction ?? 10) / 100,
    iosReleaseType: ios?.rolloutType ?? "full",
  });

  res.json({ ok: true, message: `Release v${version} started` });
}

function getReleaseStatus(_req, res) {
  res.json(releaseState);
}

function getReleaseLog(_req, res) {
  res.json({ log: releaseState.log, status: releaseState.status });
}

function appendBeaconSyncLog(localLog, line) {
  const formatted = `[beacon-sync] ${line}`;
  localLog.push(formatted);
  if (!Array.isArray(releaseState.log)) releaseState.log = [];
  releaseState.log.push(formatted);
  console.log(`[release] ${formatted}`);
}

async function postGoogleChatMessage(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google Chat webhook failed (${response.status}): ${text || response.statusText}`);
  }
}

function buildBeaconDocsChatMessage({ version, documents }) {
  return {
    text: [
      `Beacon docs added for v${version}`,
      "",
      ...documents.map((doc) => `• ${doc.fileName}: ${doc.fileUrl}`),
    ].join("\n"),
  };
}

async function testBeaconDocsSync(req, res) {
  const {
    releasePassword,
    version,
    localDocsDir,
    notifyWebhookUrl,
    beacon = {},
    r2 = {},
  } = req.body || {};

  if (!RELEASE_PASSWORD || releasePassword !== RELEASE_PASSWORD) {
    return res.status(401).json({ error: "Invalid release password" });
  }

  if (!version) {
    return res.status(400).json({ error: "version is required" });
  }

  if (!localDocsDir) {
    return res.status(400).json({ error: "localDocsDir is required" });
  }

  const requiredBeacon = BEACON_API_CALL_ENABLED_IN_CODE
    ? [
        ["baseUrl", beacon?.baseUrl],
        ["accountId", beacon?.accountId],
        ["assistantId", beacon?.assistantId],
        ["adminEmail", beacon?.adminEmail],
        ["adminPassword", beacon?.adminPassword],
      ]
    : [];
  const missingBeacon = requiredBeacon
    .filter(([, value]) => !value)
    .map(([key]) => `beacon.${key}`);

  const requiredR2 = [
    ["bucketName", r2?.bucketName],
    ["endpoint", r2?.endpoint],
    ["accessKeyId", r2?.accessKeyId],
    ["secretAccessKey", r2?.secretAccessKey],
    ["publicBaseUrl", r2?.publicBaseUrl],
  ];
  const missingR2 = requiredR2.filter(([, value]) => !value).map(([key]) => `r2.${key}`);

  const missing = [...missingBeacon, ...missingR2];
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }

  const log = [];
  const append = (line) => {
    log.push(line);
    console.log(`[beacon-test] ${line}`);
  };

  try {
    const syncConfig = {
      enabled: true,
      apiCallEnabled: BEACON_API_CALL_ENABLED_IN_CODE,
      baseUrl: beacon.baseUrl,
      accountId: beacon.accountId,
      assistantId: beacon.assistantId,
      adminEmail: beacon.adminEmail,
      adminPassword: beacon.adminPassword,
      r2BucketName: r2.bucketName,
      r2Endpoint: r2.endpoint,
      r2AccessKeyId: r2.accessKeyId,
      r2SecretAccessKey: r2.secretAccessKey,
      r2SessionToken: r2.sessionToken || null,
      r2PublicBaseUrl: r2.publicBaseUrl,
      localDocsDir,
    };

    const result = await syncSupportAgentRagDocsToBeacon(syncConfig, version, append);

    if (notifyWebhookUrl && result.documents?.length) {
      const chatPayload = buildBeaconDocsChatMessage({ version, documents: result.documents });
      await postGoogleChatMessage(notifyWebhookUrl, chatPayload);
      append("Posted Beacon docs links to notifyWebhookUrl.");
    }

    return res.json({
      ok: true,
      version,
      localDocsDir,
      created: result.created,
      uploaded: result.uploaded,
      beaconApiSkipped: result.beaconApiSkipped,
      skipped: result.skipped,
      documents: result.documents,
      log,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || String(error),
      log,
    });
  }
}

async function triggerBeaconDocsSync(req, res) {
  const { version } = req.body || {};

  if (releaseState.status === "running") {
    return res.status(409).json({ error: "A release is currently running. Try Beacon sync after it finishes." });
  }

  const normalizedVersion = String(version || "").trim().replace(/^v/i, "");
  if (!normalizedVersion) {
    return res.status(400).json({ error: "version is required" });
  }

  const log = [];
  const append = (line) => appendBeaconSyncLog(log, line);

  try {
    append(`Manual Beacon docs sync requested for v${normalizedVersion}`);
    const { beacon, googleChatBeaconDocsWebhookUrl } = getReleaseConfig();
    const result = await syncSupportAgentRagDocsToBeacon(beacon, normalizedVersion, append);

    if (googleChatBeaconDocsWebhookUrl && result.documents?.length) {
      const chatPayload = buildBeaconDocsChatMessage({
        version: normalizedVersion,
        documents: result.documents,
      });
      await postGoogleChatMessage(googleChatBeaconDocsWebhookUrl, chatPayload);
      append("Posted Beacon docs links to Google Chat.");
    }

    return res.json({
      ok: true,
      version: normalizedVersion,
      created: result.created,
      uploaded: result.uploaded,
      beaconApiSkipped: result.beaconApiSkipped,
      skipped: result.skipped,
      documents: result.documents,
      log,
    });
  } catch (error) {
    append(`Manual Beacon docs sync failed: ${error.message || String(error)}`);
    return res.status(500).json({
      ok: false,
      error: error.message || String(error),
      log,
    });
  }
}

export { startRelease, getReleaseStatus, getReleaseLog, testBeaconDocsSync, triggerBeaconDocsSync };
