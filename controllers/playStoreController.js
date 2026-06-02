import { releaseState, runReleasePipeline } from "../services/release/pipeline.js";

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

export { startRelease, getReleaseStatus, getReleaseLog };
