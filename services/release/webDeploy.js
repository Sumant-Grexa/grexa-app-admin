import { exec } from "child_process";
import simpleGit from "simple-git";
import { getWebProdConfig } from "../../config/releaseConfig.js";

/**
 * @param {string} cmd
 * @param {string} cwd
 * @param {(line: string) => void} append
 */
function runCmd(cmd, cwd, append) {
  return new Promise((resolve, reject) => {
    append(`Running ${cmd}`);
    const child = exec(cmd, { cwd, maxBuffer: 64 * 1024 * 1024 });
    const pipe = (/** @type {unknown} */ data) =>
      String(data).trim().split("\n").forEach((l) => l && append(`  ${l}`));
    child.stdout?.on("data", pipe);
    child.stderr?.on("data", pipe);
    child.on("close", (code) =>
      code === 0 ? resolve(undefined) : reject(new Error(`"${cmd}" exited with code ${code}`))
    );
  });
}

/**
 * Same steps as a dev-env deploy (see services/deployService.js), but for the
 * prod web machine: checkout release branch, flutter build web (prod flavor), rsync.
 * @param {string} branch
 * @param {(line: string) => void} append
 */
export async function deployWebProd(branch, append) {
  const { repoPath, buildOutput, flavor, remote } = getWebProdConfig();
  const git = simpleGit(repoPath);

  append(`Fetching latest from remote...`);
  await git.fetch(["--prune"]);

  append(`Discarding local changes...`);
  await git.reset(["--hard"]);
  await git.clean("f", ["-d"]);

  append(`Checking out branch: ${branch}`);
  await git.checkout(branch);
  await git.pull("origin", branch, ["--ff-only"]);

  await runCmd(`flutter build web --dart-define=FLAVOR=${flavor}`, repoPath, append);

  append(`Syncing build output to ${remote.user}@${remote.host}:${remote.path}`);
  await runCmd(
    `rsync -avz --delete --rsync-path="sudo rsync" ${buildOutput}/ ${remote.user}@${remote.host}:${remote.path}/`,
    repoPath,
    append
  );

  append(`Web deploy complete. Branch "${branch}" is live on ${remote.host}.`);
}
