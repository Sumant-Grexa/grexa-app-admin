import { ReleaseStep } from "./ReleaseStep.js";

// rsync prod web build to serve VM — mirror deployService.js rsync logic when ready
export class WebDeployStep extends ReleaseStep {
  async run(ctx) {
    ctx.append("Web deploy: not yet configured");
  }
}
