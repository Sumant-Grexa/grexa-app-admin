import { getEnvs, addEnv, removeEnv } from "../config/environments.js";
import { provisionEnv, deprovisionEnv } from "../services/envService.js";

const PASSWORD = process.env.DEPLOY_PASSWORD || "grexa@preprod";

const REMOTE_HOST = process.env.REMOTE_HOST || "34.47.166.243";
const REMOTE_USER = process.env.REMOTE_USER || "sumant";
const SOURCE_BASE = process.env.SOURCE_REPO_BASE || "/home/ubuntu/grexa-app";

/**
 * POST /api/environments
 * Body: { name: string, subdomain: string }
 */
export async function addEnvironment(req, res) {
  const { name, subdomain } = req.body;

  if (!name || !subdomain) {
    return res.status(400).json({ error: "Name and subdomain are required" });
  }

  // Derive safe id from name
  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!id) return res.status(400).json({ error: "Invalid environment name" });

  const envs = getEnvs();
  if (envs[id]) return res.status(409).json({ error: `Environment "${id}" already exists` });

  const env = {
    id,
    label: name,
    subdomain,
    repoPath: `${SOURCE_BASE}/${id}-web`,
    buildOutput: `${SOURCE_BASE}/${id}-web/build/web`,
    flavor: "dev",
    remote: {
      host: REMOTE_HOST,
      user: REMOTE_USER,
      path: `/var/www/preprod-app/${id}-web`,
    },
  };

  try {
    const log = await provisionEnv(env);
    addEnv(env);
    res.json({ ok: true, env, log });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * DELETE /api/environments/:envId
 * Body: { password: string }
 */
export async function removeEnvironment(req, res) {
  const { envId } = req.params;
  const { password } = req.body;

  if (password !== PASSWORD) {
    return res.status(401).json({ error: "Wrong password" });
  }

  const env = getEnvs()[envId];
  if (!env) return res.status(404).json({ error: "Environment not found" });

  try {
    const log = await deprovisionEnv(env);
    removeEnv(envId);
    res.json({ ok: true, log });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
