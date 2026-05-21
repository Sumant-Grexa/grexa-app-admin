import simpleGit from "simple-git";
import { ReleaseStep } from "./ReleaseStep.js";

export class GitTagStep extends ReleaseStep {
  async run(ctx) {
    ctx.tagName = `v${ctx.version}`;
    const git = simpleGit(ctx.repoPath);
    await git.addAnnotatedTag(ctx.tagName, `Release ${ctx.tagName}`);
    await git.pushTags("origin");
    ctx.append(`Tagged ${ctx.tagName} and pushed to origin`);
  }
}
