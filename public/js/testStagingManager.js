import { api } from "./api.js";
import {
  getTestStagingModules,
  getTestStagingPreferences,
  getTestStagingStates,
  saveTestStagingSelectedModule,
  startTestStaging,
  getTestStagingLog,
} from "./testStagingApi.js";
import { openTestStagingLog, startTestStagingLogPolling } from "./log.js";
import { createPaginatedSearchDropdown } from "./paginatedSearchDropdown.js";

let logPollingActive = false;

/** @type {{ moduleId: string, projectId: string, projectName: string, moduleName: string, projectIdentifier?: string } | null} */
let selectedModule = null;
/** @type {Array<{ id: string, name: string }>} */
let statusOptions = [];
const selectedStatusIds = new Set();
let moduleSelectionEnabled = false;
let moduleDropdownCtrl = null;

const MODULE_PAGE_LIMIT = 25;

function getModuleKey(module) {
  return `${String(module?.projectId || "").trim()}::${String(module?.moduleId || "").trim()}`;
}

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

function closeAllDropdowns() {
  moduleDropdownCtrl?.close();
  document.getElementById("ts-status-dropdown")?.classList.add("hidden");
}

function setModuleHint(text) {
  const hint = document.getElementById("ts-module-hint");
  if (!hint) return;
  hint.textContent = text;
}

function setModuleSelectionEnabled(enabled) {
  moduleSelectionEnabled = enabled;
  const trigger = document.getElementById("ts-module-trigger");
  if (!trigger) return;

  if (!enabled) {
    trigger.disabled = true;
    return;
  }

  if (moduleDropdownCtrl?.isLoading()) {
    trigger.disabled = false;
    return;
  }

  trigger.disabled = (moduleDropdownCtrl?.getItemCount() || 0) === 0;
}

function updateModuleDisplay() {
  const display = document.getElementById("ts-module-display");
  if (!display) return;

  if (!selectedModule) {
    if (moduleDropdownCtrl?.isLoading()) display.textContent = "Loading modules...";
    else if ((moduleDropdownCtrl?.getItemCount() || 0) > 0) display.textContent = "Select module";
    else display.textContent = "No cached module selected";
    return;
  }

  display.textContent = `${selectedModule.projectName} / ${selectedModule.moduleName}`;
}

function updateStatusDisplay() {
  const display = document.getElementById("ts-status-display");
  if (!display) return;

  if (selectedStatusIds.size === 0) {
    display.textContent = "All statuses";
    return;
  }

  const selectedNames = statusOptions
    .filter((status) => selectedStatusIds.has(status.id))
    .map((status) => status.name);

  if (selectedNames.length <= 2) {
    display.textContent = selectedNames.join(", ");
    return;
  }

  display.textContent = `${selectedNames.length} statuses selected`;
}

function renderStatusOptions(query = "") {
  const optionsEl = document.getElementById("ts-status-options");
  if (!optionsEl) return;

  const term = query.trim().toLowerCase();
  const filtered = statusOptions.filter((status) => status.name.toLowerCase().includes(term));

  optionsEl.innerHTML = "";

  const allOption = document.createElement("div");
  allOption.className = `branch-option${selectedStatusIds.size === 0 ? " selected" : ""}`;
  allOption.dataset.clearAll = "1";
  allOption.textContent = "All statuses";
  optionsEl.appendChild(allOption);

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "branch-option disabled";
    empty.textContent = "No statuses found";
    optionsEl.appendChild(empty);
    return;
  }

  for (const status of filtered) {
    const selected = selectedStatusIds.has(status.id);
    const option = document.createElement("div");
    option.className = `branch-option${selected ? " selected" : ""}`;
    option.dataset.statusId = status.id;
    option.textContent = `${selected ? "✓ " : ""}${status.name}`;
    optionsEl.appendChild(option);
  }
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

async function loadPreferences() {
  const prefs = await getTestStagingPreferences();
  selectedModule = prefs?.selectedModule || null;
  updateModuleDisplay();

  if (selectedModule) {
    setModuleSelectionEnabled(false);
    setModuleHint("Using cached selected module. Click Change to fetch/search modules.");
  } else {
    setModuleSelectionEnabled(true);
    setModuleHint("No module selected. Click Change to fetch/search modules.");
  }
}

async function loadStates(projectId) {
  const trigger = document.getElementById("ts-status-trigger");
  const search = document.getElementById("ts-status-search");

  selectedStatusIds.clear();
  statusOptions = [];
  updateStatusDisplay();
  renderStatusOptions();

  if (trigger) trigger.disabled = true;

  if (!projectId) return;

  const { states } = await getTestStagingStates(projectId);
  statusOptions = (states || []).map((state) => ({ id: state.id, name: state.name }));

  if (search) search.value = "";
  updateStatusDisplay();
  renderStatusOptions();

  if (trigger) trigger.disabled = statusOptions.length === 0;
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

function initModuleDropdown({ moduleDropdown, moduleSearch, moduleOptionsEl }) {
  moduleDropdownCtrl = createPaginatedSearchDropdown({
    dropdownEl: moduleDropdown,
    searchInputEl: moduleSearch,
    optionsEl: moduleOptionsEl,
    limit: MODULE_PAGE_LIMIT,
    debounceMs: 250,
    scrollThresholdPx: 24,
    emptyText: "No modules found",
    loadingText: "Loading modules...",
    loadMoreText: "Load more modules",
    loadingMoreText: "Loading more modules...",
    getItemKey: (module) => getModuleKey(module),
    getItemLabel: (module) => `${module.projectName} / ${module.moduleName}`,
    getSelectedKey: () => getModuleKey(selectedModule),
    loadPage: async ({ search, cursor, limit }) => {
      const response = await getTestStagingModules({ search, cursor, limit });
      return {
        items: Array.isArray(response?.modules) ? response.modules : [],
        nextCursor: response?.nextCursor || null,
        hasMore: Boolean(response?.hasMore),
      };
    },
    onSelect: async (picked) => {
      hideTsError();
      const response = await saveTestStagingSelectedModule(picked);
      selectedModule = response?.selectedModule || picked;
      const manualModuleIdInput = document.getElementById("ts-module-id-input");
      if (manualModuleIdInput) {
        manualModuleIdInput.value = String(selectedModule?.moduleId || "");
      }

      updateModuleDisplay();
      setModuleSelectionEnabled(false);
      setModuleHint("Using cached selected module. Click Change to switch.");

      try {
        await loadStates(selectedModule?.projectId || "");
      } catch (error) {
        showTsError(error instanceof Error ? error.message : "Failed to load statuses from Plane");
      }
    },
    onError: (error) => {
      showTsError(error instanceof Error ? error.message : "Failed to load modules");
    },
    onStateChange: ({ loading, itemCount }) => {
      setModuleSelectionEnabled(moduleSelectionEnabled);
      updateModuleDisplay();

      if (!loading && moduleSelectionEnabled && itemCount === 0) {
        setModuleHint("No modules found. Try another search term.");
      }
    },
  });
}

export function initTestStagingManager() {
  const modal = document.getElementById("test-staging-modal");
  const form = document.getElementById("test-staging-form");
  const manualModuleIdInput = document.getElementById("ts-module-id-input");

  const moduleTrigger = document.getElementById("ts-module-trigger");
  const moduleDropdown = document.getElementById("ts-module-dropdown");
  const moduleSearch = document.getElementById("ts-module-search");
  const moduleOptionsEl = document.getElementById("ts-module-options");
  const moduleChangeBtn = document.getElementById("ts-module-change-btn");

  const statusTrigger = document.getElementById("ts-status-trigger");
  const statusDropdown = document.getElementById("ts-status-dropdown");
  const statusSearch = document.getElementById("ts-status-search");
  const statusOptionsEl = document.getElementById("ts-status-options");

  if (!moduleDropdown || !moduleSearch || !moduleOptionsEl) {
    return;
  }

  initModuleDropdown({ moduleDropdown, moduleSearch, moduleOptionsEl });

  document.addEventListener("click", () => closeAllDropdowns());

  moduleTrigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!moduleSelectionEnabled || moduleTrigger.disabled) return;

    statusDropdown?.classList.add("hidden");
    moduleDropdownCtrl?.toggle();
    if (moduleDropdownCtrl?.isOpen()) {
      moduleDropdownCtrl.focusSearch();
    }
  });

  moduleChangeBtn?.addEventListener("click", async (event) => {
    event.preventDefault();
    hideTsError();

    try {
      setModuleSelectionEnabled(true);
      setModuleHint("Search and select a module. Results load page by page.");

      statusDropdown?.classList.add("hidden");
      moduleDropdownCtrl?.open();
      moduleDropdownCtrl?.focusSearch();
      await moduleDropdownCtrl?.ensureLoaded({ reset: true });
    } catch (error) {
      showTsError(error instanceof Error ? error.message : "Failed to load modules");
    }
  });

  statusTrigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (statusTrigger.disabled) return;

    moduleDropdownCtrl?.close();
    statusDropdown?.classList.toggle("hidden");
    if (!statusDropdown?.classList.contains("hidden")) {
      statusSearch?.focus();
    }
  });

  moduleDropdown?.addEventListener("click", (event) => event.stopPropagation());
  statusDropdown?.addEventListener("click", (event) => event.stopPropagation());

  statusSearch?.addEventListener("input", () => {
    renderStatusOptions(statusSearch.value);
  });

  statusSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") statusDropdown?.classList.add("hidden");
  });

  statusOptionsEl?.addEventListener("click", (event) => {
    const option = event.target.closest(".branch-option");
    if (!option || option.classList.contains("disabled")) return;

    if (option.dataset.clearAll === "1") {
      selectedStatusIds.clear();
    } else {
      const statusId = option.dataset.statusId;
      if (!statusId) return;

      if (selectedStatusIds.has(statusId)) selectedStatusIds.delete(statusId);
      else selectedStatusIds.add(statusId);
    }

    updateStatusDisplay();
    renderStatusOptions(statusSearch?.value || "");
  });

  document.getElementById("test-staging-open-btn")?.addEventListener("click", async () => {
    hideTsError();
    modal?.classList.remove("hidden");

    try {
      await loadEnvOptions();
      await loadPreferences();
      if (manualModuleIdInput) {
        manualModuleIdInput.value = String(selectedModule?.moduleId || "");
      }

      if (!selectedModule) {
        moduleDropdownCtrl?.clearSearch();
        await moduleDropdownCtrl?.ensureLoaded({ reset: true });
        setModuleSelectionEnabled(true);
      }

      updateModuleDisplay();
      moduleDropdownCtrl?.render();
      await loadStates(selectedModule?.projectId || "");
      await refreshExistingRunState();
    } catch (error) {
      showTsError(error instanceof Error ? error.message : "Failed to load Test Staging options");
    }
  });

  document.getElementById("test-staging-close")?.addEventListener("click", () => {
    closeAllDropdowns();
    modal?.classList.add("hidden");
  });

  document.getElementById("test-staging-cancel")?.addEventListener("click", () => {
    closeAllDropdowns();
    modal?.classList.add("hidden");
  });

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeAllDropdowns();
      modal.classList.add("hidden");
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideTsError();

    const envId = String(document.getElementById("ts-env-select")?.value || "").trim();
    const moduleId = String(manualModuleIdInput?.value || "").trim() || String(selectedModule?.moduleId || "").trim();
    const projectId = String(selectedModule?.projectId || "").trim();

    if (!envId) return showTsError("Environment is required");
    if (!moduleId) return showTsError("Module ID is required. Enter Module ID or select a module.");

    setStatusBadge("running");
    setSubmitRunning(true);

    try {
      await startTestStaging({
        envId,
        projectId,
        moduleId,
        statusIds: Array.from(selectedStatusIds),
      });
      startLogPolling();
    } catch (error) {
      showTsError(error instanceof Error ? error.message : "Failed to start test staging");
      setStatusBadge("error");
      setSubmitRunning(false);
    }
  });
}

initTestStagingManager();
