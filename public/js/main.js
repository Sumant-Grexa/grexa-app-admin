import { api } from "./api.js";
import { checkAuth, initAuth, showLogin, showApp } from "./auth.js";
import { renderEnvList, populateSelect, updateHeaderDot } from "./render.js";
import { initLog, openLog, startLogPolling } from "./log.js";

/* ── State ─────────────────────────────────────────────────────────────────── */
let statusData = {};
let branchCache = {};

/* ── Status ────────────────────────────────────────────────────────────────── */
async function loadStatus() {
  try {
    statusData = await api("GET", "/api/status");
    const deploying = Object.values(statusData).some((e) => e.deploy?.status === "deploying");
    updateHeaderDot(deploying);
    renderEnvList(statusData, branchCache, {
      onFetch: fetchBranches,
      onDeploy: deployBranch,
      onViewLog: (id) => openLog(id, statusData[id]?.label),
    });
  } catch (err) {
    console.error("Status fetch failed:", err);
  }
}

/* ── Branches ──────────────────────────────────────────────────────────────── */
async function fetchBranches(envId) {
  const sel = document.getElementById(`select-${envId}`);
  const btn = document.getElementById(`fetch-${envId}`);
  sel.innerHTML = `<option>Fetching...</option>`;
  btn.disabled = true;

  try {
    const data = await api("GET", `/api/branches/${envId}`);
    branchCache[envId] = { branches: data.branches, current: data.current };
    populateSelect(envId, branchCache[envId]);
  } catch (err) {
    sel.innerHTML = `<option>Error: ${err.message}</option>`;
  } finally {
    btn.disabled = false;
  }
}

/* ── Deploy ────────────────────────────────────────────────────────────────── */
async function deployBranch(envId, branch) {
  const label = statusData[envId]?.label || envId;
  if (!confirm(`Deploy "${branch}" to ${label}?\n\nThis will run flutter build and rsync to the serve VM.`)) return;

  try {
    await api("POST", "/api/deploy", { envId, branch });
    await loadStatus();
    setTimeout(() => {
      openLog(envId, label);
      startLogPolling(envId, loadStatus);
    }, 300);
  } catch (err) {
    alert("Deploy failed to start: " + err.message);
  }
}

/* ── Init ──────────────────────────────────────────────────────────────────── */
initAuth(() => { showApp(); loadStatus(); });
initLog(null);

document.getElementById("refresh-btn").addEventListener("click", loadStatus);

(async () => {
  const authenticated = await checkAuth();
  if (authenticated) { showApp(); await loadStatus(); }
  else showLogin();
})();

setInterval(() => {
  if (!document.getElementById("app-screen").classList.contains("hidden")) {
    loadStatus();
  }
}, 30_000);
