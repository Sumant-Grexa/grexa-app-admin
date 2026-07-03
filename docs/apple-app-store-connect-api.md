# Apple App Store Connect API — CI/CD Reference

Upload IPA builds, set release notes, and configure full/phased rollouts via the App Store Connect REST API in a CI/CD pipeline.

**API Base URL:** `https://api.appstoreconnect.apple.com/v1`  
**Format:** JSON:API  
**Auth:** JWT (ES256)

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Upload IPA Build](#2-upload-ipa-build)
3. [Create an App Store Version](#3-create-an-app-store-version)
4. [Add Release Notes (What's New)](#4-add-release-notes-whats-new)
5. [Link Build to Version](#5-link-build-to-version)
6. [Release Type Options](#6-release-type-options)
7. [Phased Rollout](#7-phased-rollout)
8. [Submit for Review](#8-submit-for-review)
9. [Complete CI/CD Script](#9-complete-cicd-script)
10. [Error Handling](#10-error-handling)
11. [Key Endpoint Reference](#11-key-endpoint-reference)

---

## 1. Authentication

### Generate an API Key

1. Go to **App Store Connect → Users and Access → Integrations → App Store Connect API**
2. Click **+** to generate a new key
3. Download the `.p8` private key file — **only downloadable once; store it as a CI secret**
4. Note your **Key ID** (10-char string) and **Issuer ID** (UUID)

Store these three values as CI environment variables:
```
ASC_KEY_ID       = "XXXXXXXXXX"
ASC_ISSUER_ID    = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
ASC_PRIVATE_KEY  = <contents of AuthKey_XXXXXXXXXX.p8>
```

### Generate a JWT Token

Algorithm: `ES256` | Max expiry: `1200` seconds (20 min)

**Node.js (`jsonwebtoken`):**
```js
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';

const privateKey = readFileSync('AuthKey_XXXXXXXXXX.p8', 'utf8');

const token = jwt.sign(
  { iss: ISSUER_ID, aud: 'appstoreconnect-v1' },
  privateKey,
  { algorithm: 'ES256', keyid: KEY_ID, expiresIn: '20m' }
);
```

**Use in every request:**
```
Authorization: Bearer <TOKEN>
```

> Generate a fresh token at the start of each CI run — they are stateless and expire in 20 min.

---

## 2. Upload IPA Build

The App Store Connect REST API does not accept binary uploads. Use **Transporter CLI** to push the `.ipa`, then use the API for all metadata and release management.

### Step 1 — Archive & Export (xcodebuild)

```bash
# Archive
xcodebuild archive \
  -scheme MyApp \
  -archivePath build/MyApp.xcarchive \
  -configuration Release

# Export .ipa
xcodebuild -exportArchive \
  -archivePath build/MyApp.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export
```

**ExportOptions.plist:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>destination</key>
  <string>upload</string>
</dict>
</plist>
```

### Step 2 — Upload via Transporter CLI

```bash
xcrun transporter \
  -m upload \
  -f build/export/MyApp.ipa \
  -apiKey   "$ASC_KEY_ID" \
  -apiIssuer "$ASC_ISSUER_ID"
```

### Step 3 — Poll Until Build is VALID

After upload, Apple processes the binary for 15–30 min. Poll until `processingState` is `VALID` before proceeding.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.appstoreconnect.apple.com/v1/builds\
?filter[app]=$APP_ID\
&filter[processingState]=VALID\
&sort=-uploadedDate\
&limit=1"
```

**Build Processing States:**

| State | Meaning |
|---|---|
| `PROCESSING` | Upload received, still processing |
| `VALID` | Ready to attach to a version |
| `INVALID` | Binary rejected — check signing/provisioning |
| `FAILED` | Upload failed |

---

## 3. Create an App Store Version

```
POST /v1/appStoreVersions
```

**Request:**
```json
{
  "data": {
    "type": "appStoreVersions",
    "attributes": {
      "platform": "IOS",
      "versionString": "2.1.0",
      "releaseType": "MANUAL"
    },
    "relationships": {
      "app": {
        "data": {
          "type": "apps",
          "id": "<APP_ID>"
        }
      }
    }
  }
}
```

**Attributes:**

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | enum | Yes | `IOS` \| `MAC_OS` \| `TV_OS` \| `WATCH_OS` |
| `versionString` | string | Yes | e.g. `"2.1.0"` |
| `releaseType` | enum | No | `MANUAL` \| `AFTER_APPROVAL` \| `SCHEDULED` (default `AFTER_APPROVAL`) |
| `earliestReleaseDate` | ISO 8601 | No | Required when `releaseType` is `SCHEDULED` |

**Response (201)** — save the returned `id` as `VERSION_ID`:
```json
{
  "data": {
    "type": "appStoreVersions",
    "id": "<VERSION_ID>",
    "attributes": {
      "platform": "IOS",
      "versionString": "2.1.0",
      "appStoreState": "PREPARE_FOR_SUBMISSION",
      "releaseType": "MANUAL"
    }
  }
}
```

**Version States:**

| State | Description |
|---|---|
| `PREPARE_FOR_SUBMISSION` | Editing metadata |
| `WAITING_FOR_REVIEW` | Submitted, queued |
| `IN_REVIEW` | Under Apple review |
| `PENDING_DEVELOPER_RELEASE` | Approved, awaiting manual release trigger |
| `READY_FOR_SALE` | Live on the App Store |
| `REJECTED` / `INVALID_BINARY` | Needs fixing |

---

## 4. Add Release Notes (What's New)

```
POST /v1/appStoreVersionLocalizations
```

**Request:**
```json
{
  "data": {
    "type": "appStoreVersionLocalizations",
    "attributes": {
      "locale": "en-US",
      "whatsNew": "• Dark mode support\n• Performance improvements\n• Bug fixes"
    },
    "relationships": {
      "appStoreVersion": {
        "data": {
          "type": "appStoreVersions",
          "id": "<VERSION_ID>"
        }
      }
    }
  }
}
```

**Update existing release notes:**
```
PATCH /v1/appStoreVersionLocalizations/<LOCALIZATION_ID>
```
```json
{
  "data": {
    "type": "appStoreVersionLocalizations",
    "id": "<LOCALIZATION_ID>",
    "attributes": {
      "whatsNew": "Updated release notes"
    }
  }
}
```

**Key attributes:**

| Field | Max Length | Description |
|---|---|---|
| `locale` | — | e.g. `en-US`, `fr-FR`, `de-DE`, `ja-JP`, `zh-Hans` |
| `whatsNew` | 4,000 chars | "What's New" text shown on the App Store listing |
| `description` | 4,000 chars | Full app description |
| `keywords` | 100 chars | Comma-separated search keywords |
| `marketingUrl` | 500 chars | Marketing website URL for this locale |
| `promotionalText` | 170 chars | Promotional text shown above description |
| `supportUrl` | 500 chars | Support website URL for this locale |

> At least one localization for the primary store language is required before review submission.

**Get existing localizations for a version:**
```
GET /v1/appStoreVersions/<VERSION_ID>/appStoreVersionLocalizations
```

---

## 5. Link Build to Version

Associate the validated build with the version record.

```
PATCH /v1/appStoreVersions/<VERSION_ID>
```

```json
{
  "data": {
    "type": "appStoreVersions",
    "id": "<VERSION_ID>",
    "relationships": {
      "build": {
        "data": {
          "type": "builds",
          "id": "<BUILD_ID>"
        }
      }
    }
  }
}
```

---

## 6. Release Type Options

Set on version create or update via `PATCH /v1/appStoreVersions/<VERSION_ID>`.

### Full Release — Automatic After Approval

```json
{
  "data": {
    "type": "appStoreVersions",
    "id": "<VERSION_ID>",
    "attributes": { "releaseType": "AFTER_APPROVAL" }
  }
}
```

App goes live the moment App Review approves it. No further action needed.

### Full Release — Manual Trigger

```json
{
  "data": {
    "type": "appStoreVersions",
    "id": "<VERSION_ID>",
    "attributes": { "releaseType": "MANUAL" }
  }
}
```

Stays in `PENDING_DEVELOPER_RELEASE` after approval. Trigger release from CI when ready:

```
POST /v1/appStoreVersionReleaseRequests
```
```json
{
  "data": {
    "type": "appStoreVersionReleaseRequests",
    "relationships": {
      "appStoreVersion": {
        "data": { "type": "appStoreVersions", "id": "<VERSION_ID>" }
      }
    }
  }
}
```

> Must be released within **30 days** of approval or the version expires.

### Scheduled Release

```json
{
  "data": {
    "type": "appStoreVersions",
    "id": "<VERSION_ID>",
    "attributes": {
      "releaseType": "SCHEDULED",
      "earliestReleaseDate": "2024-06-20T14:00:00Z"
    }
  }
}
```

Apple releases at (or shortly after) the specified UTC timestamp, provided it has passed review.

---

## 7. Phased Rollout

Gradually delivers an update to users with automatic updates enabled over 7 days. Users can still manually download at any time. Applies to updates only, not first-time submissions.

### 7-Day Schedule

| Day | % of Auto-Update Users |
|---|---|
| 1 | 1% |
| 2 | 2% |
| 3 | 5% |
| 4 | 10% |
| 5 | 20% |
| 6 | 50% |
| 7 | 100% |

### Create a Phased Release

Create this **before** submitting for review. Apple starts the rollout automatically on approval.

```
POST /v1/appStoreVersionPhasedReleases
```
```json
{
  "data": {
    "type": "appStoreVersionPhasedReleases",
    "attributes": { "phasedReleaseState": "ACTIVE" },
    "relationships": {
      "appStoreVersion": {
        "data": { "type": "appStoreVersions", "id": "<VERSION_ID>" }
      }
    }
  }
}
```

### Read Current State

```
GET /v1/appStoreVersions/<VERSION_ID>/appStoreVersionPhasedRelease
```

```json
{
  "data": {
    "type": "appStoreVersionPhasedReleases",
    "id": "<PHASED_RELEASE_ID>",
    "attributes": {
      "phasedReleaseState": "ACTIVE",
      "currentDayNumber": 3,
      "startDate": "2024-06-10T00:00:00Z"
    }
  }
}
```

### Manage Phased Release

All operations: `PATCH /v1/appStoreVersionPhasedReleases/<PHASED_RELEASE_ID>`

**Pause:**
```json
{ "data": { "type": "appStoreVersionPhasedReleases", "id": "<ID>", "attributes": { "phasedReleaseState": "PAUSED" } } }
```

**Resume:**
```json
{ "data": { "type": "appStoreVersionPhasedReleases", "id": "<ID>", "attributes": { "phasedReleaseState": "ACTIVE" } } }
```

**Skip to a specific day (e.g., jump straight to 10%):**
```json
{ "data": { "type": "appStoreVersionPhasedReleases", "id": "<ID>", "attributes": { "currentDayNumber": 4 } } }
```

**Release to 100% immediately:**
```json
{ "data": { "type": "appStoreVersionPhasedReleases", "id": "<ID>", "attributes": { "currentDayNumber": 7 } } }
```

**Halt permanently (cannot be resumed):**
```json
{ "data": { "type": "appStoreVersionPhasedReleases", "id": "<ID>", "attributes": { "phasedReleaseState": "HALTED" } } }
```

### States

| State | Description |
|---|---|
| `INACTIVE` | Not yet started |
| `ACTIVE` | Rolling out per schedule |
| `PAUSED` | Paused; resumes from same day/% on re-activation |
| `COMPLETE` | 100% delivered |
| `HALTED` | Stopped permanently |

> Total pause time allowed: **30 days**. Pausing does not reset `currentDayNumber`.

---

## 8. Submit for Review

After linking the build, adding release notes, and setting release/rollout options:

```
POST /v1/appStoreVersionSubmissions
```
```json
{
  "data": {
    "type": "appStoreVersionSubmissions",
    "relationships": {
      "appStoreVersion": {
        "data": { "type": "appStoreVersions", "id": "<VERSION_ID>" }
      }
    }
  }
}
```

**Pre-submission checklist:**
- [ ] Build uploaded and `processingState` is `VALID`
- [ ] Build linked to the version
- [ ] `whatsNew` set for at least the primary locale
- [ ] `releaseType` configured
- [ ] Phased release record created (if using phased rollout)
- [ ] Screenshots, age rating, privacy policy URL set in App Store Connect

**Cancel submission:**
```
DELETE /v1/appStoreVersionSubmissions/<SUBMISSION_ID>
```

---

## 9. Complete CI/CD Script

The IPA upload (xcodebuild + Transporter) is still a shell step since those are macOS CLI tools. All App Store Connect API calls are done in Node.js using native `fetch` (Node 18+) and `jsonwebtoken` for JWT generation.

**Install the one required package:**
```bash
npm install jsonwebtoken
```

### upload-to-appstore.mjs

```js
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';

const {
  ASC_KEY_ID,
  ASC_ISSUER_ID,
  ASC_PRIVATE_KEY_PATH,
  APP_ID,
  VERSION_STRING,
  RELEASE_NOTES,
  IPA_PATH = 'build/export/MyApp.ipa',
} = process.env;

const BASE = 'https://api.appstoreconnect.apple.com/v1';

function generateToken() {
  const privateKey = readFileSync(ASC_PRIVATE_KEY_PATH, 'utf8');
  return jwt.sign(
    { iss: ASC_ISSUER_ID, aud: 'appstoreconnect-v1' },
    privateKey,
    { algorithm: 'ES256', keyid: ASC_KEY_ID, expiresIn: '20m' }
  );
}

async function asc(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${generateToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(err.errors ?? err)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function pollForValidBuild(appId, maxAttempts = 40, intervalMs = 60_000) {
  for (let i = 1; i <= maxAttempts; i++) {
    const result = await asc('GET',
      `/builds?filter[app]=${appId}&filter[processingState]=VALID&sort=-uploadedDate&limit=1`
    );
    const buildId = result.data?.[0]?.id;
    if (buildId) return buildId;
    console.log(`  attempt ${i}/${maxAttempts} — build still processing, retrying in ${intervalMs / 1000}s...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Build did not become VALID within the allowed time.');
}

async function main() {
  // 1. Archive & export IPA (macOS CLI tools — must run on a Mac agent)
  console.log('Archiving...');
  execSync(
    'xcodebuild archive -scheme MyApp -archivePath build/MyApp.xcarchive -configuration Release',
    { stdio: 'inherit' }
  );
  execSync(
    'xcodebuild -exportArchive -archivePath build/MyApp.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build/export',
    { stdio: 'inherit' }
  );

  // 2. Upload IPA via Transporter CLI
  console.log('Uploading IPA...');
  execSync(
    `xcrun transporter -m upload -f "${IPA_PATH}" -apiKey "${ASC_KEY_ID}" -apiIssuer "${ASC_ISSUER_ID}"`,
    { stdio: 'inherit' }
  );

  // 3. Poll until build is VALID
  console.log('Waiting for build to be processed...');
  const buildId = await pollForValidBuild(APP_ID);
  console.log(`Build ready: ${buildId}`);

  // 4. Create app store version
  const versionRes = await asc('POST', '/appStoreVersions', {
    data: {
      type: 'appStoreVersions',
      attributes: {
        platform: 'IOS',
        versionString: VERSION_STRING,
        releaseType: 'MANUAL',
      },
      relationships: {
        app: { data: { type: 'apps', id: APP_ID } },
      },
    },
  });
  const versionId = versionRes.data.id;
  console.log(`Version created: ${versionId}`);

  // 5. Add release notes
  await asc('POST', '/appStoreVersionLocalizations', {
    data: {
      type: 'appStoreVersionLocalizations',
      attributes: { locale: 'en-US', whatsNew: RELEASE_NOTES },
      relationships: {
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    },
  });

  // 6. Link build to version
  await asc('PATCH', `/appStoreVersions/${versionId}`, {
    data: {
      type: 'appStoreVersions',
      id: versionId,
      relationships: {
        build: { data: { type: 'builds', id: buildId } },
      },
    },
  });

  // 7. Create phased release (remove this block for full immediate release)
  const phasedRes = await asc('POST', '/appStoreVersionPhasedReleases', {
    data: {
      type: 'appStoreVersionPhasedReleases',
      attributes: { phasedReleaseState: 'ACTIVE' },
      relationships: {
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    },
  });
  console.log(`Phased release created: ${phasedRes.data.id}`);

  // 8. Submit for review
  await asc('POST', '/appStoreVersionSubmissions', {
    data: {
      type: 'appStoreVersionSubmissions',
      relationships: {
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    },
  });
  console.log('Submitted for review.');
}

main().catch(err => { console.error(err.message); process.exit(1); });
```

**Run it:**
```bash
node upload-to-appstore.mjs
```

**Trigger manual release** (separate step, run after Apple approval):
```js
await asc('POST', '/appStoreVersionReleaseRequests', {
  data: {
    type: 'appStoreVersionReleaseRequests',
    relationships: {
      appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
    },
  },
});
```

**Required environment variables:**

| Variable | Description |
|---|---|
| `ASC_KEY_ID` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | App Store Connect issuer ID |
| `ASC_PRIVATE_KEY_PATH` | Path to the `.p8` private key file |
| `APP_ID` | App Store Connect app ID |
| `VERSION_STRING` | Version to create, e.g. `2.1.0` |
| `RELEASE_NOTES` | What's New text for en-US locale |
| `IPA_PATH` | Path to the exported `.ipa` (default: `build/export/MyApp.ipa`) |

---

## 10. Error Handling

**Error response shape:**
```json
{
  "errors": [
    {
      "status": "409",
      "code": "STATE_ERROR",
      "title": "State Error",
      "detail": "The resource is not in a modifiable state.",
      "source": { "pointer": "/data/attributes/releaseType" }
    }
  ]
}
```

**HTTP status codes:**

| Code | Meaning |
|---|---|
| `201` | Resource created |
| `204` | Success, no content (DELETE) |
| `400` | Bad request — check field values |
| `401` | JWT invalid or expired |
| `403` | Insufficient API key permissions |
| `404` | Resource not found |
| `409` | Conflict — resource in wrong state |
| `429` | Rate limited — respect `Retry-After` header |

**Common CI failures:**

| Problem | Fix |
|---|---|
| `401 Unauthorized` | Regenerate JWT; verify `kid`, `iss`, `aud` fields |
| Build stuck in `PROCESSING` | Wait up to 40 min; re-upload if stuck longer |
| `409` on version creation | That `versionString` already exists for the app |
| `409` on phased release create | A phased release already exists for this version |
| `INVALID_BINARY` | Check distribution cert, provisioning profile, bundle ID |

---

## 11. Key Endpoint Reference

| Operation | Method | Endpoint |
|---|---|---|
| **Builds** | | |
| List / poll builds | `GET` | `/v1/builds` |
| **App Store Versions** | | |
| Create version | `POST` | `/v1/appStoreVersions` |
| Update version (release type, build link) | `PATCH` | `/v1/appStoreVersions/{id}` |
| **Release Notes** | | |
| Create localization | `POST` | `/v1/appStoreVersionLocalizations` |
| Update localization | `PATCH` | `/v1/appStoreVersionLocalizations/{id}` |
| List localizations for version | `GET` | `/v1/appStoreVersions/{id}/appStoreVersionLocalizations` |
| **Phased Release** | | |
| Create phased release | `POST` | `/v1/appStoreVersionPhasedReleases` |
| Pause / resume / advance / halt | `PATCH` | `/v1/appStoreVersionPhasedReleases/{id}` |
| Read phased release for version | `GET` | `/v1/appStoreVersions/{id}/appStoreVersionPhasedRelease` |
| **Submission** | | |
| Submit for review | `POST` | `/v1/appStoreVersionSubmissions` |
| Cancel submission | `DELETE` | `/v1/appStoreVersionSubmissions/{id}` |
| **Manual Release** | | |
| Trigger release | `POST` | `/v1/appStoreVersionReleaseRequests` |

---

**Official reference:** https://developer.apple.com/documentation/appstoreconnectapi
