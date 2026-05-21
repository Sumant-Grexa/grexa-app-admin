import { ReleaseStep } from "./ReleaseStep.js";

// flutter build ipa --flavor prod — enable when iOS infrastructure is ready
export class FlutterBuildIosStep extends ReleaseStep {
  async run(ctx) {
    ctx.append("iOS build: not yet configured");
  }
}
