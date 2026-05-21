import { playStoreConfig } from "../config/playStore.js";
import { releaseState, runRelease } from "../services/playStoreService.js";

/**
 * POST /api/play-store/release
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
function startRelease(req, res) {
  const { releasePassword, platforms, releaseNotes, android, ios } = req.body;

  if (releasePassword !== playStoreConfig.releasePassword) {
    return res.status(401).json({ error: "Invalid release password" });
  }

  if (!Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: "At least one platform must be selected" });
  }

  if (platforms.includes("android")) {
    if (!android?.track) return res.status(400).json({ error: "android.track is required" });
    if (!android?.releaseName) return res.status(400).json({ error: "android.releaseName is required" });
    if (android?.userFraction == null) return res.status(400).json({ error: "android.userFraction is required" });
  }

  if (platforms.includes("ios")) {
    if (!["full", "phased"].includes(ios?.rolloutType)) {
      return res.status(400).json({ error: "ios.rolloutType must be 'full' or 'phased'" });
    }
  }

  if (releaseState.status === "running") {
    return res.status(409).json({ error: "A release is already in progress" });
  }

  if (platforms.includes("android")) {
    // fire and forget
    runRelease({
      track: android.track,
      releaseName: android.releaseName,
      userFraction: Number(android.userFraction) / 100,
      releaseNotes: releaseNotes ?? "",
    });
  }

  res.json({ ok: true, message: `Release started for: ${platforms.join(", ")}` });
}

/**
 * GET /api/play-store/status
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 */
function getReleaseStatus(_req, res) {
  res.json(releaseState);
}

/**
 * GET /api/play-store/log
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 */
function getReleaseLog(_req, res) {
  res.json({ log: releaseState.log, status: releaseState.status });
}

export { startRelease, getReleaseStatus, getReleaseLog };
