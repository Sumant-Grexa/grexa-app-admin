# iOS App Store Release — Implementation Plan

Wires `docs/apple-app-store-connect-api.md` into the existing release pipeline.
Extends `release_pipeline_plan.md` with parallel platform support and iOS.

---

## Design Changes vs Current Architecture

### Problem with current `Pipeline`

The existing `Pipeline` class in `pipeline.js` is a simple `for...await` loop:

```js
async run(ctx) {
  for (const step of this._steps) await step.execute(ctx);  // strictly sequential
}
```

This is correct for preamble steps (git checkout, set flavor) that must finish before anything else. But Android, iOS, and Web builds are completely independent after the preamble — they should run concurrently. And "tag on first platform done" is impossible to express with a linear step array.

### New pipeline shape

```
Preamble (sequential):
  GitCheckoutStep → SetFlavorStep → [BuildRunnerStep]
          │
          ▼
Parallel Platform Group (Promise.all):
  ┌─ android lane ─┐   ┌─── ios lane ───────────────┐   ┌─ web lane ──┐
  │ FlutterBuild   │   │ FlutterBuildIos             │   │ FlutterBuild│
  │ Android        │   │ AppStoreUpload              │   │ Web         │
  │ PlayStore      │   │ AppStoreConnect             │   │ WebDeploy   │
  │ Upload         │   └─────────────────────────────┘   └─────────────┘
  └────────────────┘
          │
          ▼ (first lane to complete successfully triggers this)
Finalization (sequential, once):
  GitTagStep → GitHubNotesStep
```

Each lane runs as a sequential chain. The `ParallelPlatformGroup` runs all lanes concurrently. The first lane to complete successfully triggers finalization (tag + release notes) — the others keep running regardless. If all active lanes fail, the pipeline is marked as error.

### New classes needed (both in `pipeline.js`)

**`PlatformLane`** — named sequential chain for one platform:
```js
class PlatformLane {
  constructor(platform, steps) { this.platform = platform; this.steps = steps; }
  async execute(ctx) {
    for (const step of this.steps) await step.execute(ctx);
  }
}
```

**`ParallelPlatformGroup`** — runs lanes concurrently, triggers finalization once:
```js
class ParallelPlatformGroup {
  constructor(lanes, finalizationSteps) { ... }

  async execute(ctx) {
    let finalized = false;

    const runLane = async (lane) => {
      if (!ctx.platforms.includes(lane.platform)) {
        ctx.append(`[${lane.platform}] skipped`);
        return;
      }
      ctx.append(`[${lane.platform}] ▶ starting`);
      try {
        await lane.execute(ctx);
        ctx.append(`[${lane.platform}] ✓ complete`);
        if (!finalized) {
          finalized = true;
          ctx.append(`[${lane.platform}] first done — creating release tag...`);
          for (const step of this.finalizationSteps) await step.execute(ctx);
        }
      } catch (err) {
        ctx.append(`[${lane.platform}] ✗ failed: ${err.message}`);
        ctx.platformErrors[lane.platform] = err.message;
      }
    };

    await Promise.all(this.lanes.map(runLane));

    const active = this.lanes.filter(l => ctx.platforms.includes(l.platform));
    if (active.length > 0 && active.every(l => ctx.platformErrors[l.platform])) {
      throw new Error('All platform releases failed');
    }
  }
}
```

**`ReleasePipelineBuilder`** — updated to express the new shape:
```js
class ReleasePipelineBuilder {
  constructor() { this._preamble = []; this._lanes = []; this._finalization = []; }
  addPreambleStep(step)         { this._preamble.push(step); return this; }
  addLane(platform, steps)      { this._lanes.push(new PlatformLane(platform, steps)); return this; }
  addFinalizationStep(step)     { this._finalization.push(step); return this; }
  build() {
    return new Pipeline(this._preamble, new ParallelPlatformGroup(this._lanes, this._finalization));
  }
}
```

**`Pipeline`** — updated to run preamble then group:
```js
class Pipeline {
  constructor(preamble, parallelGroup) { this._preamble = preamble; this._group = parallelGroup; }
  async run(ctx) {
    for (const step of this._preamble) await step.execute(ctx);
    await this._group.execute(ctx);
  }
}
```

### Builder usage (final shape in `runReleasePipeline`)

```js
const pipeline = new ReleasePipelineBuilder()
  // Preamble — sequential, must complete before any build starts
  .addPreambleStep(new GitCheckoutStep())
  .addPreambleStep(new SetFlavorStep())
  // .addPreambleStep(new BuildRunnerStep())   // enable when needed

  // Platform lanes — run concurrently after preamble
  .addLane('android', [
    new FlutterBuildAndroidStep(),
    new PlayStoreUploadStep(),
  ])
  .addLane('ios', [
    new FlutterBuildIosStep(),
    new AppStoreUploadStep(),
    new AppStoreConnectStep(),
  ])
  .addLane('web', [
    new FlutterBuildWebStep(),
    new WebDeployStep(),
  ])

  // Finalization — triggered once by the first lane to complete successfully
  .addFinalizationStep(new GitTagStep())
  .addFinalizationStep(new GitHubNotesStep())

  .build();
```

### Context namespacing

Currently `ctx.versionCode` and `ctx.editId` are flat. With parallel lanes writing simultaneously, they would clobber each other. Replace with platform-namespaced sub-objects.

**Current (flat — breaks with parallel):**
```js
ctx.versionCode = null;
ctx.editId = null;
```

**New (namespaced — safe for parallel):**
```js
ctx.android = { versionCode: null, editId: null };
ctx.ios     = { buildId: null, versionId: null };
ctx.web     = {};
ctx.platformErrors = {};
```

Steps updated accordingly:
- `PlayStoreUploadStep`: `ctx.versionCode` → `ctx.android.versionCode`, `ctx.editId` → `ctx.android.editId`
- `AppStoreUploadStep` (new): writes `ctx.ios.buildId`
- `AppStoreConnectStep` (new): writes `ctx.ios.versionId`
- `GitTagStep`, `GitHubNotesStep`: unchanged — `ctx.tagName`, `ctx.githubNotes` are finalization-only, written sequentially

---

## New Env Vars

```bash
# App Store Connect (iOS)
ASC_KEY_ID=XXXXXXXXXX
ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ASC_PRIVATE_KEY_PATH=/etc/grexa/AuthKey_XXXXXXXXXX.p8
ASC_APP_ID=1234567890
```

Add to `grexa-deployer.service` alongside existing Play Store vars.

---

## Updated File Tree

```
config/
  appStore.js             ← NEW: lazy singleton — ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH, ASC_APP_ID
  playStore.js            ← unchanged
  releaseConfig.js        ← unchanged
services/
  appStoreAuth.js         ← NEW: generateAppStoreToken() — mirrors googleAuth.js
  appStoreApi.js          ← NEW: pure API fns — mirrors playStoreApi.js
  googleAuth.js           ← unchanged
  playStoreApi.js         ← unchanged
  release/
    pipeline.js           ← REWRITE: PlatformLane + ParallelPlatformGroup + updated builder
    releaseContext.js      ← MODIFY: namespaced platform slots, add platforms/iosReleaseType inputs
    steps/
      ReleaseStep.js             ← unchanged
      GitCheckoutStep.js         ← unchanged
      SetFlavorStep.js           ← unchanged
      BuildRunnerStep.js         ← unchanged
      FlutterBuildAndroidStep.js ← unchanged (no ctx.versionCode writes here — that's PlayStoreUploadStep)
      FlutterBuildIosStep.js     ← IMPLEMENT (currently stub)
      FlutterBuildWebStep.js     ← unchanged (stub)
      PlayStoreUploadStep.js     ← MODIFY: ctx.versionCode → ctx.android.versionCode, ctx.editId → ctx.android.editId
      AppStoreUploadStep.js      ← NEW
      AppStoreConnectStep.js     ← NEW
      WebDeployStep.js           ← unchanged (stub)
      GitTagStep.js              ← unchanged
      GitHubNotesStep.js         ← unchanged
controllers/
  playStoreController.js  ← MODIFY: pass platforms + ios options; update releaseState field names
public/js/
  playStoreManager.js     ← VERIFY: ios payload already built, check HTML elements exist
```

---

---

# Execution Phases

## Phase 1 — Foundations  *(sequential, must finish before anything else)*

### 1A — `config/appStore.js`  *(new file)*

Lazy singleton. Same pattern as `config/playStore.js`.

```js
function loadConfig() {
  const keyId          = process.env.ASC_KEY_ID;
  const issuerId       = process.env.ASC_ISSUER_ID;
  const privateKeyPath = process.env.ASC_PRIVATE_KEY_PATH;
  const appId          = process.env.ASC_APP_ID;

  if (!keyId)          throw new Error("Missing env var: ASC_KEY_ID");
  if (!issuerId)       throw new Error("Missing env var: ASC_ISSUER_ID");
  if (!privateKeyPath) throw new Error("Missing env var: ASC_PRIVATE_KEY_PATH");
  if (!appId)          throw new Error("Missing env var: ASC_APP_ID");

  return Object.freeze({ keyId, issuerId, privateKeyPath, appId });
}
let _config = null;
export function getAppStoreConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}
```

### 1B — `services/appStoreAuth.js`  *(new file)*

Mirrors `googleAuth.js`. Generates a fresh JWT per call (no caching — short-lived token, stateless).

```js
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { getAppStoreConfig } from '../config/appStore.js';

export function generateAppStoreToken() {
  const { keyId, issuerId, privateKeyPath } = getAppStoreConfig();
  const privateKey = readFileSync(privateKeyPath, 'utf8');
  return jwt.sign(
    { iss: issuerId, aud: 'appstoreconnect-v1' },
    privateKey,
    { algorithm: 'ES256', keyid: keyId, expiresIn: '20m' }
  );
}
```

`npm install jsonwebtoken` — add to `dependencies` in `package.json`.

### 1C — `services/appStoreApi.js`  *(new file)*

Pure functions only. No state, no logging. Mirrors `playStoreApi.js`.
All functions throw on non-2xx with Apple error detail extracted from response body.

```js
const BASE = 'https://api.appstoreconnect.apple.com/v1';

async function ascFetch(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`ASC ${method} ${path} → ${res.status}: ${JSON.stringify(err.errors ?? err)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function pollForValidBuild(token, appId, buildVersion, { maxAttempts = 40, intervalMs = 60_000 } = {})
// GET /v1/builds?filter[app]=&filter[version]=&filter[processingState]=VALID&sort=-uploadedDate&limit=1
// returns buildId; throws after maxAttempts

export async function createAppStoreVersion(token, appId, versionString, releaseType)
// POST /v1/appStoreVersions
// returns versionId

export async function createLocalization(token, versionId, locale, whatsNewText)
// POST /v1/appStoreVersionLocalizations
// returns localizationId

export async function linkBuild(token, versionId, buildId)
// PATCH /v1/appStoreVersions/{versionId} (build relationship)

export async function createPhasedRelease(token, versionId)
// POST /v1/appStoreVersionPhasedReleases { phasedReleaseState: 'ACTIVE' }
// returns phasedReleaseId

export async function submitForReview(token, versionId)
// POST /v1/appStoreVersionSubmissions
// returns submissionId
```

### 1D — `services/release/releaseContext.js`  *(modify)*

Add iOS inputs, namespaced platform output slots, and `platformErrors`.

```js
export function createReleaseContext(options) {
  const { repoPath } = getReleaseConfig();
  const ctx = {
    // inputs (unchanged)
    version:        options.version,
    releaseNotes:   options.releaseNotes ?? "",
    runBuildRunner: options.runBuildRunner ?? false,

    // new inputs
    platforms:      options.platforms ?? ['android'],
    iosReleaseType: options.iosReleaseType ?? 'full',   // 'full' | 'phased' | 'manual'
    track:          options.track ?? "production",
    userFraction:   options.userFraction ?? 0.1,

    // derived paths (unchanged)
    repoPath,
    aabPath: join(repoPath, "build/app/outputs/bundle/prodRelease/app-prod-release.aab"),
    ipaPath: join(repoPath, "build/ios/ipa/Runner.ipa"),

    // namespaced output slots (replaces flat versionCode, editId)
    android: { versionCode: null, editId: null },
    ios:     { buildId: null, versionId: null },
    web:     {},

    // finalization slots (unchanged)
    tagName:      null,
    githubNotes:  null,

    // per-platform error tracking (new)
    platformErrors: {},

    // live log (unchanged)
    log: [],
    append(line) { this.log.push(line); console.log(`[release] ${line}`); },
  };
  return ctx;
}
```

---

## Phase 2 — Steps  *(all parallel after Phase 1)*

### 2A — `PlayStoreUploadStep.js`  *(modify — namespace fix only)*

Two line changes — no logic changes:
```js
ctx.editId = ...        →  ctx.android.editId = ...
ctx.versionCode = ...   →  ctx.android.versionCode = ...
```

And in `updateTrack` call:
```js
ctx.versionCode  →  ctx.android.versionCode
```

### 2B — `FlutterBuildIosStep.js`  *(implement existing stub)*

Replace stub body. Identical pattern to `FlutterBuildAndroidStep.js`.

```js
async run(ctx) {
  await new Promise((resolve, reject) => {
    const child = exec(
      "flutter build ipa --flavor prod -t lib/main_prod.dart",
      { cwd: ctx.repoPath }
    );
    // stream stdout/stderr via ctx.append()
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`flutter build ipa failed with exit code ${code}`)));
    child.on("error", reject);
  });

  if (!existsSync(ctx.ipaPath)) {
    throw new Error(`IPA not found at ${ctx.ipaPath}`);
  }
}
```

No platform guard needed here — `FlutterBuildIosStep` only exists in the iOS lane, which `ParallelPlatformGroup` skips entirely if `ios` not in `ctx.platforms`.

### 2C — `AppStoreUploadStep.js`  *(new file)*

Uploads IPA via Transporter CLI then polls until `processingState=VALID`. Sets `ctx.ios.buildId`.

```js
async run(ctx) {
  const { keyId, issuerId, appId } = getAppStoreConfig();

  // 1. xcrun transporter upload (stream output via ctx.append)
  await new Promise((resolve, reject) => {
    const child = exec(
      `xcrun transporter -m upload -f "${ctx.ipaPath}" -apiKey "${keyId}" -apiIssuer "${issuerId}"`,
      { cwd: ctx.repoPath }
    );
    // stream stdout/stderr
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`transporter failed with exit code ${code}`)));
    child.on("error", reject);
  });

  // 2. Poll for valid build
  const token = generateAppStoreToken();
  ctx.ios.buildId = await pollForValidBuild(token, appId, ctx.version);
  ctx.append(`App Store build ready: ${ctx.ios.buildId}`);
}
```

### 2D — `AppStoreConnectStep.js`  *(new file)*

Creates version, links build, sets release type, creates phased release if needed, submits for review. Sets `ctx.ios.versionId`.

```js
async run(ctx) {
  const { appId } = getAppStoreConfig();
  const token = generateAppStoreToken();   // fresh token at step entry

  // Map iosReleaseType → API releaseType
  // 'phased' | 'full' → 'AFTER_APPROVAL'
  // 'manual'          → 'MANUAL'
  const releaseType = ctx.iosReleaseType === 'manual' ? 'MANUAL' : 'AFTER_APPROVAL';

  // 1. Create version
  ctx.ios.versionId = await createAppStoreVersion(token, appId, ctx.version, releaseType);
  ctx.append(`App Store version created: ${ctx.ios.versionId}`);

  // 2. Release notes
  await createLocalization(token, ctx.ios.versionId, 'en-US', ctx.releaseNotes);

  // 3. Link build
  await linkBuild(token, ctx.ios.versionId, ctx.ios.buildId);

  // 4. Phased release record (only for 'phased')
  if (ctx.iosReleaseType === 'phased') {
    await createPhasedRelease(token, ctx.ios.versionId);
    ctx.append('Phased release configured (7-day rollout)');
  }

  // 5. Submit for review
  await submitForReview(token, ctx.ios.versionId);
  ctx.append('Submitted for App Store review.');
  // NOTE: triggerManualRelease() is intentionally not called here.
  // Manual release requires a separate post-approval action.
}
```

---

## Phase 3 — Pipeline Rewrite  *(sequential, depends on Phase 1 + 2)*

### `services/release/pipeline.js`  *(rewrite)*

Replace the current `Pipeline` + `ReleasePipelineBuilder` classes with the new 4-class structure described in the Design Changes section above.

Full updated `runReleasePipeline`:

```js
export async function runReleasePipeline(options) {
  const ctx = createReleaseContext(options);

  Object.assign(releaseState, {
    status: "running",
    log: ctx.log,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    android: { versionCode: null },
    ios: { versionId: null },
    tagName: null,
  });

  const pipeline = new ReleasePipelineBuilder()
    .addPreambleStep(new GitCheckoutStep())
    .addPreambleStep(new SetFlavorStep())
    // .addPreambleStep(new BuildRunnerStep())

    .addLane('android', [
      new FlutterBuildAndroidStep(),
      new PlayStoreUploadStep(),
    ])
    .addLane('ios', [
      new FlutterBuildIosStep(),
      new AppStoreUploadStep(),
      new AppStoreConnectStep(),
    ])
    .addLane('web', [
      new FlutterBuildWebStep(),
      new WebDeployStep(),
    ])

    .addFinalizationStep(new GitTagStep())
    .addFinalizationStep(new GitHubNotesStep())

    .build();

  try {
    await pipeline.run(ctx);
    Object.assign(releaseState, {
      status: "success",
      finishedAt: new Date().toISOString(),
      android: { versionCode: ctx.android.versionCode },
      ios: { versionId: ctx.ios.versionId },
      tagName: ctx.tagName,
    });
  } catch (err) {
    ctx.append(`Pipeline failed: ${err.message}`);
    Object.assign(releaseState, { status: "error", finishedAt: new Date().toISOString() });
  }
}
```

Update `releaseState` initial shape to match:
```js
export const releaseState = {
  status: "idle",
  log: [],
  startedAt: null,
  finishedAt: null,
  android: { versionCode: null },   // replaces flat versionCode
  ios: { versionId: null },         // new
  tagName: null,
};
```

---

## Phase 4 — Controller  *(sequential, depends on Phase 3)*

### `controllers/playStoreController.js`  *(modify)*

**Add iOS validation:**
```js
if (platforms.includes('ios')) {
  const valid = ['full', 'phased', 'manual'];
  if (!valid.includes(ios?.rolloutType)) {
    return res.status(400).json({ error: "ios.rolloutType must be 'full', 'phased', or 'manual'" });
  }
}
```

**Pass platforms + iosReleaseType through:**
```js
runReleasePipeline({
  version,
  releaseNotes: releaseNotes ?? "",
  platforms,                                      // now forwarded (was implicit android-only)
  track:          android?.track ?? "production",
  userFraction:   Number(android?.userFraction ?? 10) / 100,
  runBuildRunner: runBuildRunner === true,
  iosReleaseType: ios?.rolloutType ?? "full",     // new
});
```

**Update releaseState references** in `getReleaseStatus` — `releaseState.versionCode` no longer exists, clients should read `releaseState.android.versionCode` instead. Confirm frontend doesn't display it directly (it doesn't).

### `.env.example` + `grexa-deployer.service`  *(modify)*

Add:
```
ASC_KEY_ID=
ASC_ISSUER_ID=
ASC_PRIVATE_KEY_PATH=/etc/grexa/AuthKey_XXXXXXXXXX.p8
ASC_APP_ID=
```

---

## Phase 5 — Frontend Verification  *(independent, can run any time)*

The UI in `playStoreManager.js` already collects iOS fields and sends `ios: { rolloutType }`.
This phase is verification only.

### Verify HTML elements in `public/index.html`

| Element | ID / name | Type |
|---|---|---|
| iOS platform checkbox | `ps-ios` | checkbox |
| iOS fields container | `ps-ios-fields` | div (hidden by default) |
| Rollout — full | `ios-rollout-type` value `full` | radio |
| Rollout — phased | `ios-rollout-type` value `phased` | radio |
| Rollout — manual | `ios-rollout-type` value `manual` | radio |

If any are missing, add them following the existing Android fields pattern (`ps-android-fields` → `ps-ios-fields`).

---

## Dependency Graph

```
Phase 1 (foundations — sequential)
  ├── 1A  config/appStore.js
  ├── 1B  services/appStoreAuth.js          (depends on 1A)
  ├── 1C  services/appStoreApi.js
  └── 1D  services/release/releaseContext.js
        │
        ▼
Phase 2 (steps — all parallel, all depend on Phase 1)
  2A  PlayStoreUploadStep.js  (namespace fix — no new deps)
  2B  FlutterBuildIosStep.js  (no API deps — flutter CLI only)
  2C  AppStoreUploadStep.js   (depends on 1A, 1B, 1C)
  2D  AppStoreConnectStep.js  (depends on 1A, 1B, 1C)
        │
        ▼
Phase 3 (pipeline.js rewrite — depends on all of Phase 2)
        │
        ▼
Phase 4 (controller + env wiring — depends on Phase 3)

Phase 5 (frontend verification — independent)
```

---

## Acceptance Criteria

- [ ] `platforms: ['android']` — iOS and Web lanes log "skipped", Android runs fully, tag + notes created after Android upload
- [ ] `platforms: ['ios']` — Android and Web lanes log "skipped", iOS runs fully, tag + notes created after App Store submit
- [ ] `platforms: ['android', 'ios']` — both lanes run concurrently; whichever upload completes first triggers tag + notes; other lane continues
- [ ] `platforms: ['android', 'ios', 'web']` — all three concurrent; first to complete triggers finalization
- [ ] Platform lane failure is isolated — one failing lane does not cancel others
- [ ] All lanes failing → pipeline status `error`
- [ ] `GitTagStep` and `GitHubNotesStep` run exactly once regardless of how many platforms complete
- [ ] Log interleaving from parallel lanes is clearly prefixed: `[android]`, `[ios]`, `[web]`
- [ ] `ctx.android.versionCode` and `ctx.ios.buildId` never collide — each platform only writes its own namespace
- [ ] `FlutterBuildIosStep` throws if IPA not found at `ctx.ipaPath` after build
- [ ] `AppStoreUploadStep` throws on transporter non-zero exit
- [ ] `AppStoreUploadStep` throws after 40 poll attempts with clear timeout message
- [ ] `AppStoreConnectStep` creates phased release record only when `iosReleaseType === 'phased'`
- [ ] `AppStoreConnectStep` does NOT call `triggerManualRelease` — separate post-approval action
- [ ] `releaseState` shape updated — `android.versionCode`, `ios.versionId` instead of flat `versionCode`
- [ ] `ios.rolloutType` validated in controller with descriptive 400 on invalid value
- [ ] `jsonwebtoken` added to `package.json` dependencies
- [ ] ASC vars added to `.env.example` and `grexa-deployer.service`
- [ ] Server starts without error when ASC vars absent — `config/appStore.js` is lazy
- [ ] No circular imports: new steps → `appStoreApi.js` / `appStoreAuth.js` / `config/appStore.js` / Node stdlib only
