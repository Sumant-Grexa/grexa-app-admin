import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { getEnvs } from "../config/environments.js";

const execAsync = promisify(exec);
const ENV_VARS_PASSWORD = process.env.ENV_VARS_PASSWORD || "grexa@envvars";
const BUILD_RUNNER_CLEAN_CMD = "dart run build_runner clean";
const BUILD_RUNNER_BUILD_CMD = "dart run build_runner build --delete-conflicting-outputs";

function appendOutput(log, output) {
  if (!output) return;
  log.push(...String(output).trim().split("\n").filter(Boolean));
}

function appendExecError(log, err) {
  if (err?.stdout) appendOutput(log, err.stdout);
  if (err?.stderr) appendOutput(log, err.stderr);
}

async function runBuildRunner(repoPath, log) {
  log.push(`→ Running: ${BUILD_RUNNER_CLEAN_CMD}`);
  const cleanResult = await execAsync(BUILD_RUNNER_CLEAN_CMD, { cwd: repoPath });
  appendOutput(log, cleanResult.stdout);
  appendOutput(log, cleanResult.stderr);

  log.push(`→ Running: ${BUILD_RUNNER_BUILD_CMD}`);
  const buildResult = await execAsync(BUILD_RUNNER_BUILD_CMD, { cwd: repoPath });
  appendOutput(log, buildResult.stdout);
  appendOutput(log, buildResult.stderr);

  log.push("✓ build_runner completed");
}

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

  try {
    await runBuildRunner(env.repoPath, log);
    res.json({ ok: true, log });
  } catch (err) {
    appendExecError(log, err);
    log.push(`✗ build_runner failed: ${err.message}`);
    res.status(500).json({ error: "build_runner failed", log });
  }
}

export async function syncDevEnvVars(req, res) {
  const { password, referenceEnvId } = req.body;

  if (password !== ENV_VARS_PASSWORD) return res.status(401).json({ error: "Wrong password" });

  const envs = getEnvs();
  const referenceEnv = envs[referenceEnvId];
  if (!referenceEnv) return res.status(404).json({ error: "Reference environment not found" });
  if (referenceEnv.flavor !== "dev") {
    return res.status(400).json({ error: "Reference environment must be a dev flavor environment" });
  }

  const devEnvs = Object.values(envs).filter((env) => env.flavor === "dev");
  if (!devEnvs.length) return res.status(400).json({ error: "No dev environments found" });

  const referenceDevPath = join(referenceEnv.repoPath, ".env.dev");
  const referenceProdPath = join(referenceEnv.repoPath, ".env.prod");

  if (!existsSync(referenceDevPath)) {
    return res.status(400).json({ error: `Reference .env.dev not found at ${referenceDevPath}` });
  }
  if (!existsSync(referenceProdPath)) {
    return res.status(400).json({ error: `Reference .env.prod not found at ${referenceProdPath}` });
  }

  const sourceDevContent = readFileSync(referenceDevPath, "utf-8");
  const sourceProdContent = readFileSync(referenceProdPath, "utf-8");

  const log = [];
  const results = [];
  log.push(`Reference: ${referenceEnv.label} (${referenceEnv.id})`);
  log.push(`Dev env targets: ${devEnvs.length}`);

  for (const env of devEnvs) {
    const envLog = [];
    try {
      writeFileSync(join(env.repoPath, ".env.dev"), sourceDevContent, "utf-8");
      writeFileSync(join(env.repoPath, ".env.prod"), sourceProdContent, "utf-8");
      envLog.push("✓ Written .env.dev");
      envLog.push("✓ Written .env.prod");

      await runBuildRunner(env.repoPath, envLog);

      results.push({ envId: env.id, label: env.label, status: "success" });
    } catch (err) {
      appendExecError(envLog, err);
      envLog.push(`✗ Sync failed: ${err.message}`);
      results.push({
        envId: env.id,
        label: env.label,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const line of envLog) {
      log.push(`[${env.id}] ${line}`);
    }
  }

  const failed = results.filter((r) => r.status === "error").length;
  const success = results.length - failed;
  const ok = failed === 0;
  log.push(`Summary: ${success}/${results.length} synced successfully`);

  res.json({
    ok,
    referenceEnvId,
    results,
    successCount: success,
    failedCount: failed,
    error: ok ? undefined : `${failed} environment(s) failed to sync`,
    log,
  });
}
