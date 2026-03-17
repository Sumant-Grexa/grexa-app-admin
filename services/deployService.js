import { exec } from "child_process";
import { promisify } from "util";
import simpleGit from "simple-git";
import ENVS from "../config/environments.js";

const execAsync = promisify(exec);

/**
 * @typedef {{ status: 'deploying'|'success'|'error', targetBranch: string,
 *             branch?: string, log: string[], startedAt: string, finishedAt?: string }} DeployState
 * @type {Record<string, DeployState>}
 */
const deployState = {};

/**
 * @param {string} repoPath
 * @returns {Promise<{ branches: string[], current: string }>}
 */
async function getBranches(repoPath) {
  const git = simpleGit(repoPath);
  await git.fetch(["--prune"]);
  const result = await git.branch(["-a"]);

  const branches = Object.keys(result.branches)
    .map((b) => b.replace(/^remotes\/origin\//, "").replace(/^origin\//, ""))
    .filter((b) => !b.includes("HEAD"))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  return { branches, current: result.current };
}

/**
 * @param {string} envId
 * @param {Partial<DeployState>} patch
 */
function setState(envId, patch) {
  deployState[envId] = { ...deployState[envId], ...patch };
}

/** @param {string} envId */
async function runDeploy(envId) {
  const env = ENVS[envId];
  const git = simpleGit(env.repoPath);
  const log = [];

  /** @param {string} line */
  const append = (line) => {
    log.push(line);
    deployState[envId].log = [...log];
    console.log(`[${envId}] ${line}`);
  };

  try {
    const { targetBranch } = deployState[envId];

    append(`Fetching latest from remote...`);
    await git.fetch(["--prune"]);

    append(`Checking out branch: ${targetBranch}`);
    await git.checkout(targetBranch);
    await git.pull("origin", targetBranch, ["--ff-only"]);

    append(`Running flutter build web --dart-define=FLAVOR=${env.flavor}`);
    await new Promise((resolve, reject) => {
      const child = exec(
        `flutter build web --dart-define=FLAVOR=${env.flavor}`,
        { cwd: env.repoPath }
      );

      const pipe = (/** @type {unknown} */ data) =>
        String(data)
          .trim()
          .split("\n")
          .forEach((l) => l && append(`  ${l}`));

      child.stdout?.on("data", pipe);
      child.stderr?.on("data", pipe);
      child.on("close", (code) =>
        code === 0
          ? resolve(undefined)
          : reject(new Error(`Build exited with code ${code}`))
      );
    });

    const { host, user, path } = env.remote;
    append(`Syncing build output to ${user}@${host}:${path}`);
    await execAsync(
      `rsync -avz --delete --rsync-path="sudo rsync" ${env.buildOutput}/ ${user}@${host}:${path}/`
    );

    append(`Deploy complete! Branch "${targetBranch}" is now live.`);
    setState(envId, {
      status: "success",
      branch: targetBranch,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    append(`Error: ${err instanceof Error ? err.message : String(err)}`);
    setState(envId, { status: "error", finishedAt: new Date().toISOString() });
  }
}

export { deployState, getBranches, setState, runDeploy };
