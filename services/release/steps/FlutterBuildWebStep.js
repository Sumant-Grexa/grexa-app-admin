import { ReleaseStep } from "./ReleaseStep.js";

// flutter build web --dart-define=FLAVOR=prod — enable when web prod deploy is ready
export class FlutterBuildWebStep extends ReleaseStep {
  async run(ctx) {
    ctx.append("Web build: not yet configured");
  }
}
