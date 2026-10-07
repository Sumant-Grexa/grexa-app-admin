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
 * Checkout branch in `repoPath`, flutter build web, rsync to `remote`.
 * Shared by the release pipeline (prod machine) and dev-env prod-flavor deploys.
 * @param {{ repoPath: string, buildOutput: string, flavor: string, remote: { host: string, user: string, path: string } }} target
 * @param {string} branch
 * @param {(line: string) => void} append
 * @param {{ runBuildRunner?: boolean }} [opts]
 */
export async function deployWeb(target, branch, append, { runBuildRunner = false } = {}) {
  const { repoPath, buildOutput, flavor, remote } = target;
  const git = simpleGit(repoPath);

  append(`Fetching latest from remote...`);
  await git.fetch(["--prune"]);

  append(`Discarding local changes...`);
  await git.reset(["--hard"]);
  await git.clean("f", ["-d"]);

  append(`Checking out branch: ${branch}`);
  await git.checkout(branch);
  await git.pull("origin", branch, ["--ff-only"]);

  if (runBuildRunner) {
    await runCmd(`dart run build_runner clean`, repoPath, append);
    await runCmd(`dart run build_runner build --delete-conflicting-outputs`, repoPath, append);
  }

  await runCmd(`flutter build web --dart-define=FLAVOR=${flavor}`, repoPath, append);

  append(`Syncing build output to ${remote.user}@${remote.host}:${remote.path}`);
  await runCmd(
    `rsync -avz --delete --rsync-path="sudo rsync" ${buildOutput}/ ${remote.user}@${remote.host}:${remote.path}/`,
    repoPath,
    append
  );
}

/**
 * Release pipeline: deploy the release branch to the prod web machine.
 * @param {string} branch
 * @param {(line: string) => void} append
 */
export async function deployWebProd(branch, append) {
  const target = getWebProdConfig();
  await deployWeb(target, branch, append);
  append(`Web deploy complete. Branch "${branch}" is live on ${target.remote.host}.`);
}

/**
 * Deploy the prod flavor, built from the prod repo, to a dev env's own destination.
 * Only envs with `prodWebDeploy.enabled` are allowed.
 * @param {{ id: string, remote: { host: string, user: string, path: string }, prodWebDeploy?: { enabled?: boolean } }} env
 * @param {string} branch
 * @param {(line: string) => void} append
 * @param {{ runBuildRunner?: boolean }} [opts]
 */
export async function deployProdFlavorToEnv(env, branch, append, opts) {
  if (!env.prodWebDeploy?.enabled) throw new Error(`Env "${env.id}" is not allowed to deploy prod web`);
  // Prod source repo + flavor (same values as getWebProdConfig, minus the prod remote)
  const repoPath = process.env.FLUTTER_APP_REPO_PATH;
  if (!repoPath) throw new Error("Missing env var: FLUTTER_APP_REPO_PATH");
  const buildOutput = `${repoPath.replace(/\/+$/, "")}/build/web`;
  const flavor = process.env.WEB_PROD_FLAVOR || "prod";
  await deployWeb({ repoPath, buildOutput, flavor, remote: env.remote }, branch, append, opts);
  append(`Deploy complete! Branch "${branch}" (${flavor}) is now live on ${env.id}.`);
}
