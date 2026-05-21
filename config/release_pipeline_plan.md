# Production Release Pipeline — Implementation Plan

## Design Rationale

| Pattern | Role |
|---|---|
| **Template Method** | `ReleaseStep` base — skeleton: log start → `run(ctx)` → log done → propagate errors |
| **Chain of Responsibility** | `Pipeline` walks an ordered step array, threads `ReleaseContext`, halts on first throw |
| **Builder** | `ReleasePipelineBuilder` assembles steps; future steps are one commented line each |
| **Facade** | `runReleasePipeline(options)` — the only symbol the controller ever calls |

---

## Pipeline Sequence

```
Step 1  GitCheckoutStep          git fetch / reset / checkout master / pull
Step 2  SetFlavorStep            ./scripts/set-flavor.sh prod
Step 3  FlutterBuildAndroidStep  flutter build appbundle --flavor prod -t lib/main_prod.dart
     // BuildRunnerStep          dart run build_runner build  ← enable when user says
     // FlutterBuildIosStep      flutter build ipa --flavor prod  ← FUTURE
     // FlutterBuildWebStep      flutter build web --dart-define=FLAVOR=prod  ← FUTURE
Step 4  PlayStoreUploadStep      token → edit → upload AAB → track → commit
     // WebDeployStep            rsync prod web build  ← FUTURE
Step 5  GitTagStep               git tag v<version> + push
Step 6  GitHubNotesStep          generate-notes API → append to log (non-fatal)
```

---

## Final File Tree

```
config/
  playStore.js            ← lazy: getReleasePassword(), getPlayStoreConfig()
  releaseConfig.js        ← lazy: getReleaseConfig() — FLUTTER_APP_REPO_PATH, GITHUB_TOKEN, GITHUB_REPO
services/
  googleAuth.js           ← unchanged
  playStoreApi.js         ← pure API fns (no state): createEditSession, uploadAAB, updateTrack, commitEdit
  release/
    pipeline.js           ← Builder + Pipeline classes + runReleasePipeline() facade + releaseState
    releaseContext.js      ← createReleaseContext(options) factory
    steps/
      ReleaseStep.js
      GitCheckoutStep.js
      SetFlavorStep.js
      BuildRunnerStep.js        ← real impl, commented out in builder
      FlutterBuildAndroidStep.js
      FlutterBuildIosStep.js    ← stub (non-throwing)
      FlutterBuildWebStep.js    ← stub (non-throwing)
      PlayStoreUploadStep.js
      WebDeployStep.js          ← stub (non-throwing)
      GitTagStep.js
      GitHubNotesStep.js
controllers/
  playStoreController.js  ← slim: validate → fire-and-forget runReleasePipeline()
```

**Deleted:** `services/playStoreService.js`

---

## Env Vars

```
DEPLOY_PASSWORD=grexa@preprod
PORT=3456
SESSION_SECRET=change-me

# Play Store auth
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/etc/grexa/service-account-key.json
PACKAGE_NAME=com.grexa.app
RELEASE_PASSWORD=change-me

# Release pipeline
FLUTTER_APP_REPO_PATH=/home/ubuntu/grexa-app
GITHUB_TOKEN=ghp_...
GITHUB_REPO=Grexa/grexa-mobile
```

`AAB_PATH` removed — computed as `{FLUTTER_APP_REPO_PATH}/build/app/outputs/bundle/prodRelease/app-prod-release.aab`

---

---

# Execution Phases

## Phase 1 — Foundations  *(sequential, must finish before anything else)*

Everything else imports from these. No parallelism possible here.

### 1A — `config/releaseConfig.js`
Lazy singleton. Validates `FLUTTER_APP_REPO_PATH`, `GITHUB_TOKEN`, `GITHUB_REPO`. Throws descriptively if missing. Exports `getReleaseConfig()`.

### 1B — `config/playStore.js` *(modify existing)*
Make lazy — wrap current eager top-level code into `loadConfig()`, export `getPlayStoreConfig()` and `getReleasePassword()`. Remove `AAB_PATH` from validation (computed from repo path now).

### 1C — `services/release/releaseContext.js`
`createReleaseContext(options)` returns a plain object with:
- Inputs: `version`, `releaseNotes`, `track`, `userFraction`, `runBuildRunner`
- Derived paths: `repoPath`, `aabPath` (computed), `ipaPath` (computed)
- Output slots: `versionCode = null`, `editId = null`, `tagName = null`, `githubNotes = null`
- Live log: `log = []`, `append(line)` method

### 1D — `services/release/steps/ReleaseStep.js`
```js
export class ReleaseStep {
  get name() { return this.constructor.name; }
  async run(ctx) { throw new Error(`${this.name}.run() not implemented`); }
  async execute(ctx) {
    ctx.append(`▶ ${this.name}`);
    await this.run(ctx);
    ctx.append(`✓ ${this.name} done`);
  }
}
```

### 1E — `services/playStoreApi.js`
Pure functions extracted from `playStoreService.js`. No state, no log, no side-effects.
- `createEditSession(accessToken, packageName)` → `editId`
- `uploadAAB(accessToken, packageName, editId, aabPath)` → `versionCode`
- `updateTrack(accessToken, packageName, editId, versionCode, opts)` → raw JSON
- `commitEdit(accessToken, packageName, editId)` → raw JSON

---

## Phase 2 — Steps  *(all 9 files are independent — run as parallel agents)*

Each step lives in `services/release/steps/`. Each extends `ReleaseStep` and only implements `run(ctx)`. All stream shell output line-by-line via `ctx.append()`. All reject on non-zero exit codes (except stubs and GitHubNotesStep).

| Agent | File | Key behaviour |
|---|---|---|
| A | `GitCheckoutStep.js` | `simple-git`: fetch --prune, reset --hard, clean -fd, checkout master, pull --ff-only. Log HEAD hash. |
| B | `SetFlavorStep.js` | `exec('./scripts/set-flavor.sh prod', { cwd: ctx.repoPath })`. Stream output. Reject on failure. |
| C | `BuildRunnerStep.js` | `dart run build_runner build --delete-conflicting-outputs`. Full impl — just commented out in builder. |
| D | `FlutterBuildAndroidStep.js` | `flutter build appbundle --flavor prod -t lib/main_prod.dart`. After exit, verify `ctx.aabPath` exists with `fs.existsSync` — throw if missing. |
| E | `FlutterBuildIosStep.js` | Stub: `ctx.append("iOS build: not yet configured")`. Does not throw. |
| F | `FlutterBuildWebStep.js` | Stub: `ctx.append("Web build: not yet configured")`. Does not throw. |
| G | `PlayStoreUploadStep.js` | Import `getAccessToken` from `googleAuth.js`, all 4 fns from `playStoreApi.js`, `getPlayStoreConfig` from config. Set `ctx.versionCode`, `ctx.editId`. Only call `commitEdit` after `updateTrack` succeeds. |
| H | `WebDeployStep.js` | Stub: `ctx.append("Web deploy: not yet configured")`. Does not throw. |
| I | `GitTagStep.js` | `ctx.tagName = "v" + ctx.version`. `simple-git`: tag -a, push origin tag. |
| J | `GitHubNotesStep.js` | POST `generate-notes` with `ctx.tagName`. Set `ctx.githubNotes`. Append full notes block to log. Catch all errors → log warning, do NOT throw. |

---

## Phase 3 — Pipeline Assembly  *(sequential, depends on Phase 1 + 2)*

### 3A — `services/release/pipeline.js`

Contains three things:

**`releaseState`** (moved here from `playStoreService.js`):
```js
export const releaseState = {
  status: "idle",   // 'idle'|'running'|'success'|'error'
  log: [],
  startedAt: null,
  finishedAt: null,
  versionCode: null,
  tagName: null,
};
```

**`Pipeline` + `ReleasePipelineBuilder`**:
```js
class Pipeline {
  constructor(steps) { this._steps = steps; }
  async run(ctx) {
    for (const step of this._steps) await step.execute(ctx);
  }
}

class ReleasePipelineBuilder {
  constructor() { this._steps = []; }
  addStep(step) { this._steps.push(step); return this; }
  build() { return new Pipeline(this._steps); }
}
```

**`runReleasePipeline(options)`** (Facade):
```js
export async function runReleasePipeline(options) {
  const ctx = createReleaseContext(options);
  Object.assign(releaseState, {
    status: "running", log: ctx.log,
    startedAt: new Date().toISOString(),
    finishedAt: null, versionCode: null, tagName: null,
  });

  const pipeline = new ReleasePipelineBuilder()
    .addStep(new GitCheckoutStep())
    .addStep(new SetFlavorStep())
    // .addStep(new BuildRunnerStep())      // enable when needed
    .addStep(new FlutterBuildAndroidStep())
    // .addStep(new FlutterBuildIosStep())  // FUTURE
    // .addStep(new FlutterBuildWebStep())  // FUTURE
    .addStep(new PlayStoreUploadStep())
    // .addStep(new WebDeployStep())        // FUTURE
    .addStep(new GitTagStep())
    .addStep(new GitHubNotesStep())
    .build();

  try {
    await pipeline.run(ctx);
    Object.assign(releaseState, {
      status: "success",
      finishedAt: new Date().toISOString(),
      versionCode: ctx.versionCode,
      tagName: ctx.tagName,
    });
  } catch (err) {
    ctx.append(`Pipeline failed: ${err.message}`);
    Object.assign(releaseState, { status: "error", finishedAt: new Date().toISOString() });
  }
}
```

---

## Phase 4 — Controller + Wiring  *(sequential, depends on Phase 3)*

### 4A — `controllers/playStoreController.js` *(rewrite)*

Slim down to 3 responsibilities only:
1. Check `releasePassword !== getReleasePassword()` → 401
2. Validate required body fields → 400
3. Check `releaseState.status === "running"` → 409
4. Fire-and-forget `runReleasePipeline(options)` → 200

Updated request body shape:
```json
{
  "releasePassword": "...",
  "version": "2.36.1",
  "releaseNotes": "...",
  "runBuildRunner": false,
  "platforms": ["android"],
  "android": { "track": "production", "userFraction": 10 }
}
```

### 4B — Delete `services/playStoreService.js`

Verify nothing imports it first, then delete.

### 4C — `grexa-deployer.service` *(modify)*

Remove `AAB_PATH`. Add `FLUTTER_APP_REPO_PATH`, `GITHUB_TOKEN`, `GITHUB_REPO`.

---

## Phase 5 — Frontend wiring  *(parallel with Phase 3+4, depends on Phase 1 context shape only)*

### 5A — `public/js/playStoreManager.js` *(modify)*

Add to payload collection in the submit handler:
- `version` — from `#ps-version` input (validate non-empty, semver-ish)
- `runBuildRunner` — boolean from `#ps-build-runner` checkbox
- Pass both in payload to `startRelease()`

Add client-side validation: if `#ps-version` is empty → show error, block submit.

### 5B — `public/js/playStoreApi.js`

No changes needed — API shape is unchanged.

---

## Dependency Graph

```
Phase 1 (foundations)
  ├── 1A  config/releaseConfig.js
  ├── 1B  config/playStore.js
  ├── 1C  services/release/releaseContext.js
  ├── 1D  services/release/steps/ReleaseStep.js
  └── 1E  services/playStoreApi.js
        │
        ▼
Phase 2 (steps — all parallel, all depend on 1C + 1D)
  A B C D E F G H I J  (independent of each other)
        │
        ▼
Phase 3 (pipeline.js — depends on all of Phase 2)
        │
        ▼
Phase 4 (controller + wiring — depends on Phase 3)

Phase 5 (frontend — depends only on knowing payload shape from Phase 1C)
  can run in parallel with Phases 3 and 4
```

---

## Acceptance Criteria

- [ ] Server starts without error when Play Store/release vars absent (all config is lazy)
- [ ] Each step logs `▶ StepName` on entry and `✓ StepName done` on success
- [ ] `SetFlavorStep` runs before any flutter build
- [ ] Flutter commands are exactly:
  - Android: `flutter build appbundle --flavor prod -t lib/main_prod.dart`
  - iOS: `flutter build ipa --flavor prod`
  - Web: `flutter build web --dart-define=FLAVOR=prod`
- [ ] `BuildRunnerStep` is a full implementation but commented out in builder
- [ ] Pipeline halts at first thrown error — no Play Store commit, no tag, no GitHub notes on build failure
- [ ] AAB file existence verified after Android build — throws if missing
- [ ] `commitEdit` only called after `updateTrack` succeeds
- [ ] Git tag pushed only after Play Store commit succeeds
- [ ] GitHub notes failure is non-fatal — warns in log, pipeline still succeeds
- [ ] `releaseState.log` is the same array reference as `ctx.log` — UI polling works unchanged
- [ ] `releaseState.tagName` populated on success — available to UI
- [ ] `runBuildRunner` flag collected from form checkbox and passed in payload
- [ ] `version` field validated non-empty client-side before form submits
- [ ] `playStoreService.js` deleted — zero references remain
- [ ] No circular imports: steps → `playStoreApi.js` / `googleAuth.js` / `config/*` / `simple-git` / Node stdlib only
