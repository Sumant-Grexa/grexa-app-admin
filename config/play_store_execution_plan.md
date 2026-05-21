# Play Store Automated Release — Execution Plan

## Context

This document breaks the Google Play Store upload feature into discrete, parallelisable implementation steps. The app is a **Node.js ESM / Express** project with the pattern `routes → controllers → services`. All new code must follow that pattern. Authentication uses a **service account** (JWT → access token) — no user OAuth flow, no external auth libraries, only Node.js built-in `crypto`.

Reference spec: `config/google_play_apis.md`

---

## Architecture Overview

```
routes/playStore.js
    └── controllers/playStoreController.js
            └── services/playStoreService.js   ← all API calls live here
                    ├── services/googleAuth.js  ← JWT builder + token exchange
                    └── config/playStore.js     ← env-var validation + constants
```

New env vars required (add to systemd service file):
```
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/absolute/path/to/service-account-key.json
PACKAGE_NAME=com.example.app
AAB_PATH=/absolute/path/to/app-release.aab
RELEASE_PASSWORD=<secret>
```

The service account JSON key file (downloaded from Google Cloud Console) contains all auth credentials. It must **not** be committed to git — add it to `.gitignore`.

---

## Phase 0 — Service Account Setup (one-time, manual)

> No code needed. Done once by a human with GCP + Play Console access.

### Step 0.1 — Enable the API
- Google Cloud Console → APIs & Services → Library
- Search **Google Play Android Developer API** → Enable
- Make sure the project is the one linked to your Play Console app

### Step 0.2 — Create a Service Account
- Google Cloud Console → IAM & Admin → Service Accounts → **Create service account**
- Give it a descriptive name (e.g. `grexa-play-release`)
- Skip GCP role assignment (Play Console controls permissions, not GCP IAM) → Done

### Step 0.3 — Download the JSON Key
- Open the service account → **Keys** tab → **Add key → Create new key → JSON**
- Download the file — this is the only time you can download it
- Place it on the server at a secure path (e.g. `/etc/grexa/service-account-key.json`)
- Set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` to that path in the systemd service

### Step 0.4 — Grant Play Console permissions
- Google Play Console → Users and permissions → **Invite new users**
- Enter the service account's `client_email` (from the JSON key file)
- Under **App permissions**, select the target app
- Assign: **Release manager** (covers uploading + managing tracks + rollout)
- Save invitation

---

## Phase 1 — Backend Core

### Step 1.1 — Config validator `config/playStore.js`
**Create** `config/playStore.js`

Responsibilities:
- Read the service account JSON key from the path in `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`
- Validate required top-level fields in the JSON (`private_key`, `client_email`, `private_key_id`, `token_uri`)
- Validate `PACKAGE_NAME` and `AAB_PATH` env vars
- Throw a descriptive error at startup for any missing config (same pattern as `config/environments.js`)
- Export a frozen `playStoreConfig` object

```js
// Expected export shape
export const playStoreConfig = {
  serviceAccount: {           // parsed from the JSON key file
    clientEmail: '...',
    privateKey: '...',
    privateKeyId: '...',
    tokenUri: 'https://oauth2.googleapis.com/token',
  },
  packageName: process.env.PACKAGE_NAME,
  aabPath: process.env.AAB_PATH,
};
```

---

### Step 1.2 — Google Auth service `services/googleAuth.js`
**Create** `services/googleAuth.js`

Responsibilities:
- Build and sign a JWT using only Node.js built-in `crypto` (no external libraries)
- Exchange the JWT for an access token at `https://oauth2.googleapis.com/token`
- Use `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`

#### JWT construction:

**Header:**
```json
{ "alg": "RS256", "typ": "JWT", "kid": "<private_key_id>" }
```

**Payload:**
```json
{
  "iss": "<client_email>",
  "scope": "https://www.googleapis.com/auth/androidpublisher",
  "aud": "https://oauth2.googleapis.com/token",
  "iat": <now_unix_seconds>,
  "exp": <now + 3600>
}
```

**Signing:** `crypto.createSign('SHA256')` + RS256 (RSASSA-PKCS1-v1_5 with SHA-256)

**Base64url encoding:** replace `+` → `-`, `/` → `_`, strip trailing `=`

**Token endpoint request:**
```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=<JWT>
```

**Function to export:**
```js
// Returns a fresh access token string. Valid for 3600s.
export async function getAccessToken(serviceAccount) { ... }
```

No token caching needed — the release flow is short-lived.

---

### Step 1.3 — Play Store service `services/playStoreService.js`
**Create** `services/playStoreService.js`

Each function maps to one API step from `config/google_play_apis.md`. Uses native `fetch`. Calls `getAccessToken()` from `services/googleAuth.js` at the start of `runRelease()` and threads the token through.

#### Functions:

**`createEditSession(accessToken)`** — Step 1
- POST `.../edits` → returns `editId` string

**`uploadAAB(accessToken, editId)`** — Step 2
- `fs.readFileSync(aabPath)` as binary Buffer
- POST with `Content-Type: application/octet-stream`
- Returns `versionCode` number

**`updateTrack(accessToken, editId, versionCode, options)`** — Step 3
- PUT `.../tracks/{track}`
- `options`: `{ track, releaseName, status, userFraction, releaseNotes }`
- Returns raw response JSON

**`commitEdit(accessToken, editId)`** — Step 4
- POST `.../{editId}:commit`
- Returns raw response JSON

**`runRelease(options)`** — orchestrator
- Gets access token first via `getAccessToken()`
- Runs steps 1–4 in order
- Logs `editId` and `versionCode` to console at each step
- Does NOT call `commitEdit` if any earlier step throws
- Returns `{ editId, versionCode, commitResponse }`

#### In-memory release state (same pattern as `deployState`):
```js
export const releaseState = {
  status: 'idle',   // 'idle' | 'running' | 'success' | 'error'
  log: [],
  startedAt: null,
  finishedAt: null,
  versionCode: null,
  editId: null,
};
```

---

### Step 1.4 — Controller `controllers/playStoreController.js`
**Create** `controllers/playStoreController.js`

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/play-store/release` | `startRelease` | Fire-and-forget release kickoff |
| GET | `/api/play-store/status` | `getReleaseStatus` | Returns full `releaseState` |
| GET | `/api/play-store/log` | `getReleaseLog` | Returns `{ log, status }` |

`startRelease` body:
```json
{
  "releasePassword": "<must match RELEASE_PASSWORD env var>",
  "platforms": ["android", "ios", "web"],
  "releaseNotes": "Bug fixes and improvements.",
  "android": {
    "track": "production",
    "releaseName": "v1.0.0",
    "userFraction": 0.10
  },
  "ios": {
    "rolloutType": "phased"
  }
}
```

Platform rules enforced by the controller:
- `platforms` must contain at least one of `android`, `ios`, `web`
- If `android` is in `platforms`, `android.track`, `android.releaseName`, and `android.userFraction` (0.01–1.0) are required
- If `ios` is in `platforms`, `ios.rolloutType` must be `full` or `phased`
- `web` requires no extra fields (reserved for future use — acknowledged but not acted on yet)
- `releaseNotes` is a single plain-text string shared across all platforms

Guards:
- 409 if `releaseState.status === 'running'`
- 400 if `track` or `releaseName` are missing
- 401 if `releasePassword` field does not match `RELEASE_PASSWORD` env var — checked server-side before any API call is made

---

### Step 1.5 — Route `routes/playStore.js` + wiring
**Create** `routes/playStore.js`
- Import `requireAuth` from `middleware/auth.js`
- Mount all 3 handlers behind auth

**Modify** `routes/index.js`
- Import and mount playStore router at `/api/play-store`

---

## Phase 2 — Frontend UI

### Step 2.1 — API client `public/js/playStoreApi.js`
**Create** `public/js/playStoreApi.js`

```js
export async function startRelease(payload) { ... }   // POST /api/play-store/release
export async function getReleaseStatus() { ... }       // GET /api/play-store/status
export async function getReleaseLog() { ... }          // GET /api/play-store/log
```

Same pattern as `public/js/api.js`.

---

### Step 2.2 — UI section in `public/index.html`
**Modify** `public/index.html`

New section below existing environments — the **Release** form:

**Platform checkboxes (required — pick one or more):**
- `[ ] Android`
- `[ ] iOS` *(placeholder — future)*
- `[ ] Web` *(placeholder — future)*

**Conditional fields shown only when Android is checked:**
- Track selector: `internal` / `alpha` / `beta` / `production`
- Release name input (e.g. `v1.0.0`)
- Rollout % input (1–100, shown always when Android is checked — maps to `userFraction`; set to 1.0 / hidden label "Full rollout" when 100 is entered)

**Conditional fields shown only when iOS is checked:**
- Rollout type radio: `Full rollout` / `Phased rollout`

**Always-visible fields:**
- Release notes textarea (shared across platforms)
- Release password input (`type="password"`)

**Submit area:**
- "Release" button — sharp red background (`#d32f2f`), white bold text, with a ⚠ warning icon prefix — disabled and greyed while a release is running
- Inline warning text beneath the button: *"This will publish to production. Double-check before releasing."*

**Status + log:**
- Status badge (idle / running / success / error)
- Scrollable log panel (same style as existing deploy log)

---

### Step 2.3 — UI logic `public/js/playStoreManager.js`
**Create** `public/js/playStoreManager.js`
- Show/hide Android fields when Android checkbox is toggled
- Show/hide iOS rollout radio when iOS checkbox is toggled
- Wire form submit → collect payload → call `startRelease()`
- Poll `getReleaseLog()` every 2s while `status === 'running'`
- Stop polling on `success` or `error`
- Render log lines into the log panel
- Update status badge colour
- Disable the Release button + show spinner while running; re-enable on completion

---

## Phase 3 — Environment & Config Wiring

### Step 3.1 — Systemd service file
**Modify** `grexa-deployer.service`:
```ini
Environment=GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/etc/grexa/service-account-key.json
Environment=PACKAGE_NAME=com.example.app
Environment=AAB_PATH=/path/to/app-release.aab
Environment=RELEASE_PASSWORD=<secret>
```

### Step 3.2 — Gitignore
**Modify** `.gitignore` — ensure `*.json` key files are excluded or add a specific pattern for the key file name.

### Step 3.3 — README
**Modify** `README.md` — add a section documenting all required env vars and the service account setup steps.

---

## Parallelisation Map

```
Phase 0 — manual setup (no code)
    │
    ▼ Phase 1 — backend (must be sequential due to dependency chain)
    │
    ├─ Step 1.1  config/playStore.js
    │       ↓
    ├─ Step 1.2  services/googleAuth.js      ← depends on 1.1
    │       ↓
    ├─ Step 1.3  services/playStoreService.js ← depends on 1.2
    │       ↓
    ├─ Step 1.4  controllers/playStoreController.js ← depends on 1.3
    │       ↓
    └─ Step 1.5  routes/playStore.js + index.js wiring ← depends on 1.4

Phase 2 — frontend (agents can be parallel once Phase 1 API surface is known)
    ├─ Agent A → Step 2.1 playStoreApi.js
    ├─ Agent B → Step 2.2 index.html section
    └─ Agent C → Step 2.3 playStoreManager.js  ← depends on A + B

Phase 3 — config wiring (manual + sequential)
```

---

## Files to Create / Modify

| Action | File |
|--------|------|
| CREATE | `config/playStore.js` |
| CREATE | `services/googleAuth.js` |
| CREATE | `services/playStoreService.js` |
| CREATE | `controllers/playStoreController.js` |
| CREATE | `routes/playStore.js` |
| MODIFY | `routes/index.js` |
| CREATE | `public/js/playStoreApi.js` |
| CREATE | `public/js/playStoreManager.js` |
| MODIFY | `public/index.html` |
| MODIFY | `grexa-deployer.service` |
| MODIFY | `.gitignore` |
| MODIFY | `README.md` |

---

## Acceptance Criteria

- [ ] Config throws at startup if service account JSON is missing or malformed
- [ ] JWT is built and signed using only Node.js `crypto` — no external JWT/auth libraries
- [ ] `getAccessToken()` successfully exchanges the JWT for a Bearer token
- [ ] Steps 1–4 run in order; `commitEdit` is skipped on any prior error
- [ ] `editId` and `versionCode` are printed to console after their steps
- [ ] POST `/api/play-store/release` returns 401 if `releasePassword` is wrong
- [ ] POST `/api/play-store/release` returns 409 if already running
- [ ] POST `/api/play-store/release` returns 400 if no platform is selected or required platform fields are missing
- [ ] All endpoints are behind `requireAuth` middleware
- [ ] Android section (track, release name, rollout %) only shown when Android checkbox is checked
- [ ] iOS rollout radio only shown when iOS checkbox is checked
- [ ] Release button is sharp red (`#d32f2f`) with warning icon; disabled while running
- [ ] Warning text visible below the Release button at all times
- [ ] Service account key file is never committed to git
