import { createReleaseContext } from "./releaseContext.js";
import { GitCheckoutStep } from "./steps/GitCheckoutStep.js";
import { SetFlavorStep } from "./steps/SetFlavorStep.js";
// import { BuildRunnerStep } from "./steps/BuildRunnerStep.js";  // enable when needed
import { FlutterBuildAndroidStep } from "./steps/FlutterBuildAndroidStep.js";
// import { FlutterBuildIosStep } from "./steps/FlutterBuildIosStep.js";   // FUTURE
// import { FlutterBuildWebStep } from "./steps/FlutterBuildWebStep.js";   // FUTURE
import { PlayStoreUploadStep } from "./steps/PlayStoreUploadStep.js";
// import { WebDeployStep } from "./steps/WebDeployStep.js";               // FUTURE
import { GitTagStep } from "./steps/GitTagStep.js";
import { GitHubNotesStep } from "./steps/GitHubNotesStep.js";

class Pipeline {
  /** @param {import("./steps/ReleaseStep.js").ReleaseStep[]} steps */
  constructor(steps) {
    this._steps = steps;
  }

  /** @param {import("./releaseContext.js").ReleaseContext} ctx */
  async run(ctx) {
    for (const step of this._steps) {
      await step.execute(ctx);
    }
  }
}

class ReleasePipelineBuilder {
  constructor() {
    this._steps = [];
  }

  addStep(step) {
    this._steps.push(step);
    return this;
  }

  build() {
    return new Pipeline(this._steps);
  }
}

export const releaseState = {
  status: "idle",
  log: [],
  startedAt: null,
  finishedAt: null,
  versionCode: null,
  tagName: null,
};

/**
 * @param {{ version: string, releaseNotes: string, track: string, userFraction: number, runBuildRunner: boolean }} options
 */
export async function runReleasePipeline(options) {
  const ctx = createReleaseContext(options);

  Object.assign(releaseState, {
    status: "running",
    log: ctx.log,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    versionCode: null,
    tagName: null,
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
