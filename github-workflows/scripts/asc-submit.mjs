#!/usr/bin/env node
// App Store Connect submission script.
// Called by release-ios.yml after the IPA is uploaded via Transporter.
// All config comes from env vars — no file system secrets.

import { createSign } from "crypto";

const {
  ASC_KEY_ID,
  ASC_ISSUER_ID,
  ASC_PRIVATE_KEY,   // raw PEM contents (not a path)
  ASC_APP_ID,
  VERSION_STRING,
  RELEASE_NOTES = "",
  ROLLOUT_TYPE = "full",  // 'full' | 'phased' | 'manual'
} = process.env;

for (const [name, val] of Object.entries({ ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, ASC_APP_ID, VERSION_STRING })) {
  if (!val) throw new Error(`Missing env var: ${name}`);
}

const BASE = "https://api.appstoreconnect.apple.com/v1";

// ── JWT (ES256, no external deps) ────────────────────────────────────────────
function generateToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" })).toString("base64url");
  const data = `${header}.${payload}`;
  const sign = createSign("SHA256");
  sign.update(data);
  const sig = sign.sign(ASC_PRIVATE_KEY, "base64url");
  return `${data}.${sig}`;
}

// ── API fetch ─────────────────────────────────────────────────────────────────
async function asc(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${generateToken()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`ASC ${method} ${path} → ${res.status}: ${JSON.stringify(err.errors ?? err)}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── Poll for valid build ──────────────────────────────────────────────────────
async function pollForValidBuild(maxAttempts = 40, intervalMs = 60_000) {
  for (let i = 1; i <= maxAttempts; i++) {
    const data = await asc("GET", `/builds?filter[app]=${ASC_APP_ID}&filter[processingState]=VALID&sort=-uploadedDate&limit=1`);
    const buildId = data.data?.[0]?.id;
    if (buildId) return buildId;
    console.log(`  [${i}/${maxAttempts}] Build still processing, retrying in ${intervalMs / 1000}s…`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Build did not become VALID within the allowed time.");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // releaseType mapping
  const releaseType = ROLLOUT_TYPE === "manual" ? "MANUAL" : "AFTER_APPROVAL";

  // 1. Poll for valid build
  console.log("Waiting for build to be processed by Apple…");
  const buildId = await pollForValidBuild();
  console.log(`Build ready: ${buildId}`);

  // 2. Create App Store version
  const versionRes = await asc("POST", "/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: { platform: "IOS", versionString: VERSION_STRING, releaseType },
      relationships: { app: { data: { type: "apps", id: ASC_APP_ID } } },
    },
  });
  const versionId = versionRes.data.id;
  console.log(`App Store version created: ${versionId}`);

  // 3. Release notes
  if (RELEASE_NOTES) {
    await asc("POST", "/appStoreVersionLocalizations", {
      data: {
        type: "appStoreVersionLocalizations",
        attributes: { locale: "en-US", whatsNew: RELEASE_NOTES },
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
      },
    });
    console.log("Release notes set.");
  }

  // 4. Link build to version
  await asc("PATCH", `/appStoreVersions/${versionId}`, {
    data: {
      type: "appStoreVersions",
      id: versionId,
      relationships: { build: { data: { type: "builds", id: buildId } } },
    },
  });
  console.log("Build linked to version.");

  // 5. Phased release (only for 'phased')
  if (ROLLOUT_TYPE === "phased") {
    await asc("POST", "/appStoreVersionPhasedReleases", {
      data: {
        type: "appStoreVersionPhasedReleases",
        attributes: { phasedReleaseState: "ACTIVE" },
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
      },
    });
    console.log("Phased release configured (7-day rollout).");
  }

  // 6. Submit for review
  await asc("POST", "/appStoreVersionSubmissions", {
    data: {
      type: "appStoreVersionSubmissions",
      relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
    },
  });
  console.log("Submitted for App Store review.");
}

main().catch((err) => { console.error(err.message); process.exit(1); });
