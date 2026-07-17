import simpleGit from "simple-git";
import { getEnvs } from "../config/environments.js";
import { deployState, getBranches, setState, runDeploy } from "../services/deployService.js";

/**
 * GET /api/status
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 */
async function getStatus(_req, res) {
  const envEntries = Object.entries(getEnvs()); // preserve definition order

  const settled = await Promise.all(
    envEntries.map(async ([id, env]) => {
      try {
        const git = simpleGit(env.repoPath);
        const [branchSummary, log] = await Promise.all([
          git.branch(),
          git.log(["-1"]).catch(() => null),
        ]);
        return [id, {
          ...env,
          currentBranch: branchSummary.current,
          lastCommit: log?.latest
            ? { author: log.latest.author_name, hash: log.latest.hash.slice(0, 7) }
            : null,
          deploy: deployState[id] ?? null,
        }];
      } catch (err) {
        return [id, {
          ...env,
          currentBranch: null,
          error: err instanceof Error ? err.message : String(err),
          deploy: deployState[id] ?? null,
        }];
      }
    })
  );

  // rebuild in original key order
  const result = Object.fromEntries(settled);
  res.json(result);
}

/**
 * GET /api/branches/:envId
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getEnvBranches(req, res) {
  const env = getEnvs()[req.params.envId];
  if (!env) return res.status(404).json({ error: "Unknown environment" });

  try {
    const data = await getBranches(env.repoPath);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * POST /api/deploy
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
function startDeploy(req, res) {
  const { envId, branch, runBuildRunner = false, additionalFlags = "" } = req.body;
  const env = getEnvs()[envId];

  if (!env) return res.status(404).json({ error: "Unknown environment" });
  if (!branch) return res.status(400).json({ error: "Branch is required" });

  const current = deployState[envId];
  if (current?.status === "deploying") {
    return res.status(409).json({ error: "Deploy already in progress" });
  }

  setState(envId, {
    status: "deploying",
    targetBranch: branch,
    runBuildRunner: !!runBuildRunner,
    additionalFlags: env.flavor === "dev" && typeof additionalFlags === "string"
      ? additionalFlags.trim()
      : "",
    log: [],
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
  });

  // fire and forget
  runDeploy(envId);

  res.json({ ok: true, message: `Deploy started for ${envId} → ${branch}` });
}

/**
 * GET /api/deploy-log/:envId
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
function getDeployLog(req, res) {
  const state = deployState[req.params.envId];
  if (!state) return res.json({ log: [], status: null });
  res.json({ log: state.log, status: state.status });
}

export { getStatus, getEnvBranches, startDeploy, getDeployLog };
