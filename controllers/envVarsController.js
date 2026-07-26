import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { getEnvs } from "../config/environments.js";

const execAsync = promisify(exec);
const ENV_VARS_PASSWORD = process.env.ENV_VARS_PASSWORD || "grexa@envvars";
const BUILD_RUNNER_CLEAN_CMD = "dart run build_runner clean";
const BUILD_RUNNER_BUILD_CMD = "dart run build_runner build --delete-conflicting-outputs";
const SYNC_TASK_TTL_MS = 30 * 60 * 1000;
const syncEnvVarsTasks = new Map();

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

function ensureEnvVarsPassword(password, res) {
  if (password !== ENV_VARS_PASSWORD) {
    res.status(401).json({ error: "Wrong password" });
    return false;
  }
  return true;
}

function getEnvById(envId) {
  return getEnvs()[envId];
}

function cleanupExpiredSyncTasks() {
  const now = Date.now();
  for (const [taskId, task] of syncEnvVarsTasks.entries()) {
    if (!task.finishedAt) continue;
    const age = now - new Date(task.finishedAt).getTime();
    if (age > SYNC_TASK_TTL_MS) syncEnvVarsTasks.delete(taskId);
  }
}

function serializeSyncTask(task) {
  return {
    taskId: task.taskId,
    sourceEnvId: task.sourceEnvId,
    destinationEnvId: task.destinationEnvId,
    status: task.status,
    error: task.error,
    log: task.log,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}

async function syncSourceToDestinationEnv(sourceEnvId, destinationEnvId, log) {
  const sourceEnv = getEnvById(sourceEnvId);
  if (!sourceEnv) throw new Error(`Source environment "${sourceEnvId}" not found`);
  if (sourceEnv.flavor !== "dev") throw new Error("Source environment must be a dev flavor environment");

  const destinationEnv = getEnvById(destinationEnvId);
  if (!destinationEnv) throw new Error(`Destination environment "${destinationEnvId}" not found`);
  if (destinationEnv.flavor !== "dev") {
    throw new Error("Destination environment must be a dev flavor environment");
  }

  const sourceDevPath = join(sourceEnv.repoPath, ".env.dev");
  const sourceProdPath = join(sourceEnv.repoPath, ".env.prod");
  if (!existsSync(sourceDevPath)) throw new Error(`Source .env.dev not found at ${sourceDevPath}`);
  if (!existsSync(sourceProdPath)) throw new Error(`Source .env.prod not found at ${sourceProdPath}`);

  const sourceDevContent = readFileSync(sourceDevPath, "utf-8");
  const sourceProdContent = readFileSync(sourceProdPath, "utf-8");

  writeFileSync(join(destinationEnv.repoPath, ".env.dev"), sourceDevContent, "utf-8");
  writeFileSync(join(destinationEnv.repoPath, ".env.prod"), sourceProdContent, "utf-8");
  log.push(`✓ Written .env.dev from ${sourceEnvId}`);
  log.push(`✓ Written .env.prod from ${sourceEnvId}`);

  await runBuildRunner(destinationEnv.repoPath, log);
  return {
    sourceEnvId,
    destinationEnvId,
    destinationLabel: destinationEnv.label,
  };
}

async function runSyncEnvVarsTask(taskId) {
  const task = syncEnvVarsTasks.get(taskId);
  if (!task) return;

  task.status = "running";
  task.startedAt = new Date().toISOString();

  try {
    await syncSourceToDestinationEnv(task.sourceEnvId, task.destinationEnvId, task.log);
    task.status = "success";
  } catch (err) {
    appendExecError(task.log, err);
    const message = err instanceof Error ? err.message : String(err);
    task.log.push(`✗ Sync failed: ${message}`);
    task.error = message;
    task.status = "error";
  } finally {
    task.finishedAt = new Date().toISOString();
  }
}

export async function readEnvVars(req, res) {
  const { envId } = req.params;
  const { password } = req.body;

  if (!ensureEnvVarsPassword(password, res)) return;

  const env = getEnvById(envId);
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

  if (!ensureEnvVarsPassword(password, res)) return;

  const env = getEnvById(envId);
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

export async function syncEnvVarsBySourceDestination(req, res) {
  const { password, sourceEnvId, destinationEnvId } = req.body;
  if (!ensureEnvVarsPassword(password, res)) return;
  const log = [];
  if (!sourceEnvId || !destinationEnvId) {
    return res.status(400).json({ error: "sourceEnvId and destinationEnvId are required" });
  }

  try {
    const result = await syncSourceToDestinationEnv(sourceEnvId, destinationEnvId, log);
    res.json({ ok: true, ...result, log });
  } catch (err) {
    appendExecError(log, err);
    const message = err instanceof Error ? err.message : String(err);
    log.push(`✗ Sync failed: ${message}`);
    res.status(500).json({
      ok: false,
      sourceEnvId,
      destinationEnvId,
      error: message,
      log,
    });
  }
}

export function startSyncEnvVarsTask(req, res) {
  const { password, sourceEnvId, destinationEnvId } = req.body;
  if (!ensureEnvVarsPassword(password, res)) return;
  cleanupExpiredSyncTasks();

  if (!sourceEnvId || !destinationEnvId) {
    return res.status(400).json({ error: "sourceEnvId and destinationEnvId are required" });
  }

  const taskId = randomUUID();
  const task = {
    taskId,
    sourceEnvId,
    destinationEnvId,
    status: "queued",
    error: null,
    log: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  syncEnvVarsTasks.set(taskId, task);

  void runSyncEnvVarsTask(taskId);
  res.json({ ok: true, taskId, status: task.status });
}

export function getSyncEnvVarsTaskStatus(req, res) {
  const { taskId } = req.params;
  cleanupExpiredSyncTasks();
  const task = syncEnvVarsTasks.get(taskId);
  if (!task) return res.status(404).json({ error: "Sync task not found" });
  res.json({ ok: true, task: serializeSyncTask(task) });
}
