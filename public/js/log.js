import { api } from "./api.js";
import { esc } from "./render.js";

/** envId → { label, log: string[] } for tabs currently open */
const openTabs = {};
let activeTabId = null;
const pollers = {};

function getDrawer()    { return document.getElementById("log-drawer"); }
function getTabsEl()    { return document.getElementById("drawer-tabs"); }
function getOutputEl()  { return document.getElementById("drawer-log-output"); }

function renderTabs() {
  const tabsEl = getTabsEl();
  tabsEl.innerHTML = "";
  for (const [envId, { label }] of Object.entries(openTabs)) {
    const tab = document.createElement("button");
    tab.className = "drawer-tab" + (envId === activeTabId ? " active" : "");
    tab.dataset.envId = envId;
    tab.innerHTML = `
      <span class="drawer-tab-label">${esc(label)}</span>
      <span class="drawer-tab-close" data-env-id="${envId}" title="Close tab">&#x2715;</span>
    `;
    tabsEl.appendChild(tab);
  }
}

function renderLog(envId) {
  const out = getOutputEl();
  const entry = openTabs[envId];
  if (!entry || !entry.log || entry.log.length === 0) {
    out.innerHTML = `<span class="log-line-plain">No log output yet…</span>`;
    return;
  }
  out.innerHTML = entry.log.map((line) => {
    if (line.startsWith("Deploy complete") || line.startsWith("Skipping"))
      return `<span class="log-line-ok">${esc(line)}</span>`;
    if (line.startsWith("Error:"))
      return `<span class="log-line-err">${esc(line)}</span>`;
    if (/^(Fetching|Checking|Running|Syncing|Clearing|Copying|Discarding)/.test(line))
      return `<span class="log-line-step">${esc(line)}</span>`;
    return `<span class="log-line-plain">${esc(line)}</span>`;
  }).join("\n");
  out.scrollTop = out.scrollHeight;
}

function switchTab(envId) {
  activeTabId = envId;
  renderTabs();
  renderLog(envId);
}

function closeTab(envId) {
  delete openTabs[envId];
  if (pollers[envId]) {
    clearInterval(pollers[envId]);
    delete pollers[envId];
  }
  if (activeTabId === envId) {
    const remaining = Object.keys(openTabs);
    activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  }
  if (Object.keys(openTabs).length === 0) {
    getDrawer().classList.add("hidden");
    activeTabId = null;
  } else {
    renderTabs();
    if (activeTabId) renderLog(activeTabId);
  }
}

export function initLog(_onClose) {
  document.getElementById("drawer-close").addEventListener("click", () => {
    Object.keys(openTabs).forEach((id) => {
      if (pollers[id]) { clearInterval(pollers[id]); delete pollers[id]; }
    });
    Object.keys(openTabs).forEach((k) => delete openTabs[k]);
    activeTabId = null;
    getDrawer().classList.add("hidden");
    document.getElementById("app-screen").classList.remove("drawer-open");
  });

  getTabsEl().addEventListener("click", (e) => {
    const closeBtn = e.target.closest(".drawer-tab-close");
    if (closeBtn) {
      e.stopPropagation();
      closeTab(closeBtn.dataset.envId);
      return;
    }
    const tab = e.target.closest(".drawer-tab");
    if (tab) switchTab(tab.dataset.envId);
  });
}

export async function openLog(envId, label) {
  if (!openTabs[envId]) {
    openTabs[envId] = { label: label || envId, log: [] };
  }
  activeTabId = envId;
  getDrawer().classList.remove("hidden");
  renderTabs();
  await refreshLog(envId);
}

export async function refreshLog(envId) {
  try {
    const data = await api("GET", `/api/deploy-log/${envId}`);
    if (openTabs[envId]) openTabs[envId].log = data.log ?? [];
    if (activeTabId === envId) renderLog(envId);
  } catch {}
}

export function startLogPolling(envId, onDone) {
  if (pollers[envId]) return;
  pollers[envId] = setInterval(async () => {
    try {
      const data = await api("GET", `/api/deploy-log/${envId}`);
      if (openTabs[envId]) openTabs[envId].log = data.log ?? [];
      if (activeTabId === envId) renderLog(envId);
      if (data.status !== "deploying") {
        clearInterval(pollers[envId]);
        delete pollers[envId];
        if (onDone) onDone();
      }
    } catch {
      clearInterval(pollers[envId]);
      delete pollers[envId];
    }
  }, 1500);
}
