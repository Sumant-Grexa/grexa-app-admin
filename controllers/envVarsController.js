import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { getEnvs } from "../config/environments.js";

const execAsync = promisify(exec);
const ENV_VARS_PASSWORD = process.env.ENV_VARS_PASSWORD || "grexa@envvars";

export async function readEnvVars(req, res) {
  const { envId } = req.params;
  const { password } = req.body;

  if (password !== ENV_VARS_PASSWORD) return res.status(401).json({ error: "Wrong password" });

  const env = getEnvs()[envId];
  if (!env) return res.status(404).json({ error: "Environment not found" });

  const devPath  = join(env.repoPath, ".env.dev");
  const prodPath = join(env.repoPath, ".env.prod");

  res.json({
    devContent:  existsSync(devPath)  ? readFileSync(devPath,  "utf-8") : "",
    prodContent: existsSync(prodPath) ? readFileSync(prodPath, "utf-8") : "",
  });
}

export async function writeEnvVars(req, res) {
  const { envId } = req.params;
  const { password, devContent, prodContent } = req.body;

  if (password !== ENV_VARS_PASSWORD) return res.status(401).json({ error: "Wrong password" });

  const env = getEnvs()[envId];
  if (!env) return res.status(404).json({ error: "Environment not found" });

  const log = [];

  if (devContent !== undefined) {
    writeFileSync(join(env.repoPath, ".env.dev"), devContent, "utf-8");
    log.push("✓ Written .env.dev");
  }
  if (prodContent !== undefined) {
    writeFileSync(join(env.repoPath, ".env.prod"), prodContent, "utf-8");
    log.push("✓ Written .env.prod");
  }

  log.push("→ Running: dart run build_runner build --delete-conflicting-outputs");

  try {
    const { stdout, stderr } = await execAsync(
      "dart run build_runner build --delete-conflicting-outputs",
      { cwd: env.repoPath }
    );
    if (stdout) log.push(...stdout.trim().split("\n").filter(Boolean));
    if (stderr) log.push(...stderr.trim().split("\n").filter(Boolean));
    log.push("✓ build_runner completed");
    res.json({ ok: true, log });
  } catch (err) {
    if (err.stdout) log.push(...err.stdout.trim().split("\n").filter(Boolean));
    if (err.stderr) log.push(...err.stderr.trim().split("\n").filter(Boolean));
    log.push(`✗ build_runner failed: ${err.message}`);
    res.status(500).json({ error: "build_runner failed", log });
  }
}
