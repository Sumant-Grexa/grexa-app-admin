import { exec } from "child_process";
import { ReleaseStep } from "./ReleaseStep.js";
import { getAppStoreConfig } from "../../../config/appStore.js";
import { generateAppStoreToken } from "../../appStoreAuth.js";
import { pollForValidBuild } from "../../appStoreApi.js";

export class AppStoreUploadStep extends ReleaseStep {
  async run(ctx) {
    const { keyId, issuerId, appId } = getAppStoreConfig();

    ctx.append("Uploading IPA via Transporter...");
    await new Promise((resolve, reject) => {
      const child = exec(
        `xcrun transporter -m upload -f "${ctx.ipaPath}" -apiKey "${keyId}" -apiIssuer "${issuerId}"`,
        { cwd: ctx.repoPath }
      );

      const streamLines = (data) => {
        data
          .toString()
          .split("\n")
          .filter((line) => line.trim() !== "")
          .forEach((line) => ctx.append(`  ${line}`));
      };

      child.stdout?.on("data", streamLines);
      child.stderr?.on("data", streamLines);

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`xcrun transporter failed with exit code ${code}`));
        } else {
          resolve();
        }
      });

      child.on("error", reject);
    });

    ctx.append("IPA uploaded — waiting for Apple to process build (this takes 15–30 min)...");

    const token = generateAppStoreToken();
    ctx.ios.buildId = await pollForValidBuild(token, appId, ctx.version, {
      maxAttempts: 40,
      intervalMs: 60_000,
    });
    ctx.append(`App Store build ready: ${ctx.ios.buildId}`);
  }
}
