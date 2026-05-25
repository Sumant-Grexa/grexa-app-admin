import { createReleaseContext } from "./releaseContext.js";
import { GitCheckoutStep } from "./steps/GitCheckoutStep.js";
import { SetFlavorStep } from "./steps/SetFlavorStep.js";
// import { BuildRunnerStep } from "./steps/BuildRunnerStep.js";  // enable when needed
import { FlutterBuildAndroidStep } from "./steps/FlutterBuildAndroidStep.js";
import { FlutterBuildIosStep } from "./steps/FlutterBuildIosStep.js";
import { FlutterBuildWebStep } from "./steps/FlutterBuildWebStep.js";
import { PlayStoreUploadStep } from "./steps/PlayStoreUploadStep.js";
import { AppStoreUploadStep } from "./steps/AppStoreUploadStep.js";
import { AppStoreConnectStep } from "./steps/AppStoreConnectStep.js";
import { WebDeployStep } from "./steps/WebDeployStep.js";
import { GitTagStep } from "./steps/GitTagStep.js";
import { GitHubNotesStep } from "./steps/GitHubNotesStep.js";

// ─── PlatformLane ─────────────────────────────────────────────────────────────
// Named sequential chain of steps for one platform.
class PlatformLane {
  constructor(platform, steps) {
    this.platform = platform;
    this._steps = steps;
  }

  async execute(ctx) {
    for (const step of this._steps) {
      await step.execute(ctx);
    }
  }
}

// ─── ParallelPlatformGroup ────────────────────────────────────────────────────
// Runs all lanes concurrently via Promise.all.
// The first lane to complete successfully runs finalization (tag + release notes)
// exactly once. Other lanes continue running regardless.
// Only throws if every active lane fails.
class ParallelPlatformGroup {
  constructor(lanes, finalizationSteps) {
    this._lanes = lanes;
    this._finalizationSteps = finalizationSteps;
  }

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
          for (const step of this._finalizationSteps) {
            await step.execute(ctx);
          }
        }
      } catch (err) {
        ctx.append(`[${lane.platform}] ✗ failed: ${err.message}`);
        ctx.platformErrors[lane.platform] = err.message;
      }
    };

    await Promise.all(this._lanes.map(runLane));

    const active = this._lanes.filter((l) => ctx.platforms.includes(l.platform));
    const allFailed = active.length > 0 && active.every((l) => ctx.platformErrors[l.platform]);
    if (allFailed) {
      throw new Error(
        `All platform releases failed: ${Object.entries(ctx.platformErrors)
          .map(([p, e]) => `${p}: ${e}`)
          .join("; ")}`
      );
    }
  }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────
class Pipeline {
  constructor(preamble, parallelGroup) {
    this._preamble = preamble;
    this._group = parallelGroup;
  }

  async run(ctx) {
    for (const step of this._preamble) {
      await step.execute(ctx);
    }
    await this._group.execute(ctx);
  }
}

// ─── ReleasePipelineBuilder ───────────────────────────────────────────────────
class ReleasePipelineBuilder {
  constructor() {
    this._preamble = [];
    this._lanes = [];
    this._finalization = [];
  }

  addPreambleStep(step) {
    this._preamble.push(step);
    return this;
  }

  addLane(platform, steps) {
    this._lanes.push(new PlatformLane(platform, steps));
    return this;
  }

  addFinalizationStep(step) {
    this._finalization.push(step);
    return this;
  }

  build() {
    return new Pipeline(
      this._preamble,
      new ParallelPlatformGroup(this._lanes, this._finalization)
    );
  }
}

// ─── Release State ────────────────────────────────────────────────────────────
export const releaseState = {
  status: "idle",       // 'idle' | 'running' | 'success' | 'error'
  log: [],
  startedAt: null,
  finishedAt: null,
  android: { versionCode: null },
  ios: { versionId: null },
  tagName: null,
};

// ─── Facade ───────────────────────────────────────────────────────────────────
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
    // Preamble — sequential, shared across all platforms
    .addPreambleStep(new GitCheckoutStep())
    .addPreambleStep(new SetFlavorStep())
    // .addPreambleStep(new BuildRunnerStep())  // enable when needed

    // Platform lanes — run concurrently after preamble completes
    .addLane("android", [
      new FlutterBuildAndroidStep(),
      new PlayStoreUploadStep(),
    ])
    .addLane("ios", [
      new FlutterBuildIosStep(),
      new AppStoreUploadStep(),
      new AppStoreConnectStep(),
    ])
    .addLane("web", [
      new FlutterBuildWebStep(),
      new WebDeployStep(),
    ])

    // Finalization — runs once, triggered by the first lane to complete successfully
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
