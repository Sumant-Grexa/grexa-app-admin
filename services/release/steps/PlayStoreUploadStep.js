import { getAccessToken } from "../../googleAuth.js";
import { createEditSession, uploadAAB, updateTrack, commitEdit } from "../../playStoreApi.js";
import { getPlayStoreConfig } from "../../../config/playStore.js";
import { ReleaseStep } from "./ReleaseStep.js";

export class PlayStoreUploadStep extends ReleaseStep {
  async run(ctx) {
    const { serviceAccount, packageName } = getPlayStoreConfig();

    ctx.append("Obtaining access token...");
    const accessToken = await getAccessToken(serviceAccount);
    ctx.append("Access token obtained");

    ctx.append("Creating edit session...");
    ctx.editId = await createEditSession(accessToken, packageName);
    ctx.append(`editId=${ctx.editId}`);

    ctx.append(`Uploading AAB...`);
    ctx.versionCode = await uploadAAB(accessToken, packageName, ctx.editId, ctx.aabPath);
    ctx.append(`versionCode=${ctx.versionCode}`);

    ctx.append("Updating track...");
    await updateTrack(accessToken, packageName, ctx.editId, ctx.versionCode, {
      track: ctx.track,
      releaseName: "v" + ctx.version,
      userFraction: ctx.userFraction,
      releaseNotes: ctx.releaseNotes,
    });

    ctx.append("Committing edit...");
    await commitEdit(accessToken, packageName, ctx.editId);
    ctx.append("Edit committed — release is live");
  }
}
