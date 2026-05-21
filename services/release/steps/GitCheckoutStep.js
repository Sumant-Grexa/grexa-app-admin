import { ReleaseStep } from "./ReleaseStep.js";
import simpleGit from "simple-git";

export class GitCheckoutStep extends ReleaseStep {
  async run(ctx) {
    const git = simpleGit(ctx.repoPath);

    await git.fetch(["--prune"]);
    await git.reset(["--hard"]);
    await git.clean("f", ["-d"]);
    await git.checkout("master");
    await git.pull("origin", "master", ["--ff-only"]);

    const hash = await git.revparse(["HEAD"]);
    ctx.append(`HEAD: ${hash.trim()}`);
  }
}
