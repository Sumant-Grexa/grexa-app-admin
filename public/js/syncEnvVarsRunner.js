import { api } from "./api.js";

function toErrorMessage(data, fallback) {
  if (data && typeof data.error === "string" && data.error) return data.error;
  return fallback;
}

export function getAllDevEnvEntries(statusData) {
  return Object.entries(statusData || {}).filter(([, env]) => env?.flavor === "dev");
}

export async function getFreshDevEnvEntries() {
  const statusData = await api("GET", "/api/status");
  return getAllDevEnvEntries(statusData);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startSyncOneTask({ password, sourceEnvId, destinationEnvId }) {
  const res = await fetch("/api/environments/env-vars/sync-one/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, sourceEnvId, destinationEnvId }),
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401) {
    return { status: "auth_error", reason: toErrorMessage(data, "Wrong password"), data };
  }
  if (!res.ok || data.ok === false) {
    return { status: "failed", reason: toErrorMessage(data, "Sync failed"), data };
  }
  return { status: "success", taskId: data.taskId, data };
}

async function pollSyncOneTask({
  taskId,
  destinationEnvId,
  onLog,
  pollingIntervalMs = 2000,
}) {
  let sentLogLines = 0;

  while (true) {
    const data = await api("GET", `/api/environments/env-vars/sync-one/status/${taskId}`);
    const task = data.task || {};

    const currentLog = Array.isArray(task.log) ? task.log : [];
    if (currentLog.length > sentLogLines) {
      const nextChunk = currentLog.slice(sentLogLines);
      sentLogLines = currentLog.length;
      onLog?.(destinationEnvId, nextChunk);
    }

    if (task.status === "success") {
      return { status: "success", data: task };
    }
    if (task.status === "error") {
      return {
        status: "failed",
        reason: toErrorMessage(task, "Sync failed"),
        data: task,
      };
    }

    await sleep(pollingIntervalMs);
  }
}

async function callSyncOne({ password, sourceEnvId, destinationEnvId, onLog }) {
  const startResult = await startSyncOneTask({ password, sourceEnvId, destinationEnvId });
  if (startResult.status !== "success") return startResult;
  return pollSyncOneTask({
    taskId: startResult.taskId,
    destinationEnvId,
    onLog,
  });
}

export async function runSyncForAllDevEnvs({
  password,
  sourceEnvId,
  parallel = false,
  concurrency = 3,
  onTargetsResolved,
  onStart,
  onSuccess,
  onFailed,
  onLog,
}) {
  const devEnvEntries = await getFreshDevEnvEntries();
  const targets = devEnvEntries
    .map(([envId]) => envId)
    .filter((envId) => envId !== sourceEnvId);
  onTargetsResolved?.({
    devEnvEntries,
    targetEnvIds: targets,
    sourceEnvId,
  });

  let done = 0;
  let failed = 0;

  if (!parallel) {
    for (const destinationEnvId of targets) {
      onStart?.(destinationEnvId);

      try {
        const result = await callSyncOne({ password, sourceEnvId, destinationEnvId, onLog });

        if (result.status === "auth_error") {
          onFailed?.(destinationEnvId, result.reason);
          failed += 1;
          return {
            total: targets.length,
            done,
            failed,
            aborted: true,
            fatalError: result.reason,
          };
        }

        if (result.status === "failed") {
          onFailed?.(destinationEnvId, result.reason);
          failed += 1;
          continue;
        }

        onSuccess?.(destinationEnvId, result.data);
        done += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        onFailed?.(destinationEnvId, reason);
        failed += 1;
      }
    }

    return { total: targets.length, done, failed, aborted: false };
  }

  const maxWorkers = Math.max(1, Number(concurrency) || 1);
  const workersCount = Math.min(maxWorkers, Math.max(1, targets.length));
  let index = 0;
  let authAborted = false;
  let fatalError = "";
  const startedTargets = new Set();

  const worker = async () => {
    while (true) {
      if (authAborted) return;

      const currentIndex = index;
      index += 1;
      if (currentIndex >= targets.length) return;

      const destinationEnvId = targets[currentIndex];
      startedTargets.add(destinationEnvId);
      onStart?.(destinationEnvId);

      try {
        const result = await callSyncOne({ password, sourceEnvId, destinationEnvId, onLog });

        if (result.status === "auth_error") {
          authAborted = true;
          fatalError = result.reason;
          onFailed?.(destinationEnvId, result.reason);
          failed += 1;
          return;
        }

        if (result.status === "failed") {
          onFailed?.(destinationEnvId, result.reason);
          failed += 1;
          continue;
        }

        onSuccess?.(destinationEnvId, result.data);
        done += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        onFailed?.(destinationEnvId, reason);
        failed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: workersCount }, () => worker()));

  if (authAborted) {
    for (const envId of targets) {
      if (startedTargets.has(envId)) continue;
      onFailed?.(envId, "Skipped due to auth failure");
      failed += 1;
    }
    return { total: targets.length, done, failed, aborted: true, fatalError };
  }

  return { total: targets.length, done, failed, aborted: false };
}
