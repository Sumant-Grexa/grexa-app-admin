import { api } from "./api.js";
import {
  getTestStagingModules,
  getTestStagingStates,
  startTestStaging,
  getTestStagingLog,
} from "./testStagingApi.js";
import { openTestStagingLog, startTestStagingLogPolling } from "./log.js";

let logPollingActive = false;

function showTsError(message) {
  const el = document.getElementById("ts-error");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideTsError() {
  const el = document.getElementById("ts-error");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

function setStatusBadge(status) {
  const badge = document.getElementById("ts-status-badge");
  if (!badge) return;

  badge.className = "deploy-badge";
  switch (status) {
    case "running":
      badge.classList.add("deploying");
      badge.textContent = "RUNNING";
      break;
    case "success":
      badge.classList.add("success");
      badge.textContent = "SUCCESS";
      break;
    case "error":
      badge.classList.add("error");
      badge.textContent = "ERROR";
      break;
    default:
      badge.classList.add("idle");
      badge.textContent = "IDLE";
      break;
  }
}

function setSubmitRunning(running) {
  const btn = document.getElementById("ts-start-btn");
  if (!btn) return;

  if (running) {
    btn.disabled = true;
    btn.textContent = "Running...";
    return;
  }

  btn.disabled = false;
  btn.textContent = "Start Test Staging";
}

async function loadEnvOptions() {
  const envSelect = document.getElementById("ts-env-select");
  if (!envSelect) return;

  const status = await api("GET", "/api/status");
  const entries = Object.entries(status);

  envSelect.innerHTML = '<option value="">Select environment</option>';

  for (const [envId, env] of entries) {
    const option = document.createElement("option");
    option.value = envId;
    option.textContent = env.label || envId;
    envSelect.appendChild(option);
  }
}

async function loadModules() {
  const moduleSelect = document.getElementById("ts-module-select");
  if (!moduleSelect) return;

  moduleSelect.innerHTML = '<option value="">Loading modules...</option>';

  const { modules } = await getTestStagingModules();

  moduleSelect.innerHTML = '<option value="">Select module</option>';

  for (const module of modules) {
    const option = document.createElement("option");
    option.value = module.moduleId;
    option.dataset.projectId = module.projectId;
    option.textContent = `${module.projectName} / ${module.moduleName}`;
    moduleSelect.appendChild(option);
  }

  if (modules.length === 0) {
    moduleSelect.innerHTML = '<option value="">No modules found</option>';
  }
}

async function loadStates(projectId) {
  const statusSelect = document.getElementById("ts-status-select");
  if (!statusSelect) return;

  statusSelect.innerHTML = '<option value="">All statuses</option>';

  if (!projectId) return;

  const { states } = await getTestStagingStates(projectId);

  for (const state of states) {
    const option = document.createElement("option");
    option.value = state.id;
    option.textContent = state.name;
    statusSelect.appendChild(option);
  }
}

function startLogPolling() {
  if (logPollingActive) return;

  logPollingActive = true;
  openTestStagingLog("Test Staging").catch(() => {});

  startTestStagingLogPolling(async (data) => {
    logPollingActive = false;
    const finalData = data || (await getTestStagingLog().catch(() => null));
    setStatusBadge(finalData?.status || "error");
    setSubmitRunning(false);
    if (finalData?.status === "error" && Array.isArray(finalData.log)) {
      const errorLine = [...finalData.log].reverse().find((line) => typeof line === "string" && line.startsWith("Error:"));
      if (errorLine) showTsError(errorLine);
    }
  });
}

async function refreshExistingRunState() {
  try {
    const data = await getTestStagingLog();
    setStatusBadge(data.status || "idle");

    if (Array.isArray(data.log) && data.log.length > 0) {
      await openTestStagingLog("Test Staging");
    }

    if (data.status === "running") {
      setSubmitRunning(true);
      startLogPolling();
    } else {
      setSubmitRunning(false);
    }
  } catch {
    setStatusBadge("idle");
    setSubmitRunning(false);
  }
}

export function initTestStagingManager() {
  const modal = document.getElementById("test-staging-modal");
  const form = document.getElementById("test-staging-form");
  const moduleSelect = document.getElementById("ts-module-select");

  document.getElementById("test-staging-open-btn")?.addEventListener("click", async () => {
    hideTsError();
    modal?.classList.remove("hidden");

    try {
      await loadEnvOptions();
      await loadModules();
      await refreshExistingRunState();
      const projectId = moduleSelect?.selectedOptions?.[0]?.dataset?.projectId || "";
      await loadStates(projectId);
    } catch (error) {
      showTsError(error instanceof Error ? error.message : "Failed to load Test Staging options");
    }
  });

  document.getElementById("test-staging-close")?.addEventListener("click", () => {
    modal?.classList.add("hidden");
  });

  document.getElementById("test-staging-cancel")?.addEventListener("click", () => {
    modal?.classList.add("hidden");
  });

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  moduleSelect?.addEventListener("change", async () => {
    hideTsError();

    const projectId = moduleSelect.selectedOptions?.[0]?.dataset?.projectId || "";
    try {
      await loadStates(projectId);
    } catch (error) {
      showTsError(error instanceof Error ? error.message : "Failed to load statuses from Plane");
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideTsError();

    const envId = String(document.getElementById("ts-env-select")?.value || "").trim();
    const moduleId = String(document.getElementById("ts-module-select")?.value || "").trim();
    const statusId = String(document.getElementById("ts-status-select")?.value || "").trim();
    const projectId = moduleSelect?.selectedOptions?.[0]?.dataset?.projectId || "";

    if (!envId) return showTsError("Environment is required");
    if (!moduleId) return showTsError("Module is required");
    if (!projectId) return showTsError("Selected module is missing project mapping");

    setStatusBadge("running");
    setSubmitRunning(true);

    try {
      await startTestStaging({ envId, projectId, moduleId, statusId: statusId || undefined });
      startLogPolling();
    } catch (error) {
      showTsError(error instanceof Error ? error.message : "Failed to start test staging");
      setStatusBadge("error");
      setSubmitRunning(false);
    }
  });
}

initTestStagingManager();
