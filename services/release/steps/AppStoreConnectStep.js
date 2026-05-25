import { ReleaseStep } from "./ReleaseStep.js";
import { getAppStoreConfig } from "../../../config/appStore.js";
import { generateAppStoreToken } from "../../appStoreAuth.js";
import {
  createAppStoreVersion,
  createLocalization,
  linkBuild,
  createPhasedRelease,
  submitForReview,
} from "../../appStoreApi.js";

export class AppStoreConnectStep extends ReleaseStep {
  async run(ctx) {
    const { appId } = getAppStoreConfig();
    // Fresh token at step entry — safe within the 20-min window for a single step's calls
    const token = generateAppStoreToken();

    // 'phased' | 'full' → AFTER_APPROVAL (Apple auto-releases, phased record controls rollout speed)
    // 'manual'          → MANUAL (stays in PENDING_DEVELOPER_RELEASE until triggered separately)
    const releaseType = ctx.iosReleaseType === "manual" ? "MANUAL" : "AFTER_APPROVAL";

    ctx.ios.versionId = await createAppStoreVersion(token, appId, ctx.version, releaseType);
    ctx.append(`App Store version created: ${ctx.ios.versionId}`);

    await createLocalization(token, ctx.ios.versionId, "en-US", ctx.releaseNotes);
    ctx.append("Release notes set");

    await linkBuild(token, ctx.ios.versionId, ctx.ios.buildId);
    ctx.append(`Build ${ctx.ios.buildId} linked to version`);

    if (ctx.iosReleaseType === "phased") {
      const phasedId = await createPhasedRelease(token, ctx.ios.versionId);
      ctx.append(`Phased release configured: ${phasedId} (7-day rollout)`);
    }

    await submitForReview(token, ctx.ios.versionId);
    ctx.append("Submitted for App Store review.");
    // Note: triggerManualRelease() is intentionally not called here.
    // Manual release is a separate post-approval action via the API.
  }
}
