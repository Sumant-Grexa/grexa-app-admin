import { api } from "./api.js";
import { esc } from "./render.js";

let activeEnvId = null;
const pollers = {};

export function initLog(onClose) {
  document.getElementById("close-log").addEventListener("click", () => {
    document.getElementById("log-panel").classList.add("hidden");
    activeEnvId = null;
    if (onClose) onClose();
  });
}

export function openLog(envId, label) {
  activeEnvId = envId;
  document.getElementById("log-title").textContent = `Deploy Log — ${label || envId}`;
  document.getElementById("log-panel").classList.remove("hidden");
  refreshLog(envId);
}

export async function refreshLog(envId) {
  try {
    const data = await api("GET", `/api/deploy-log/${envId}`);
    const out = document.getElementById("log-output");
    out.innerHTML = data.log.map((line) => {
      if (line.startsWith("Deploy complete")) return `<span class="log-line-ok">${esc(line)}</span>`;
      if (line.startsWith("Error:"))          return `<span class="log-line-err">${esc(line)}</span>`;
      if (/^(Fetching|Checking|Running|Syncing|Clearing|Copying)/.test(line))
        return `<span class="log-line-step">${esc(line)}</span>`;
      return `<span class="log-line-plain">${esc(line)}</span>`;
    }).join("\n");
    out.scrollTop = out.scrollHeight;
  } catch {}
}

export function startLogPolling(envId, onDone) {
  if (pollers[envId]) return;
  pollers[envId] = setInterval(async () => {
    try {
      const data = await api("GET", `/api/deploy-log/${envId}`);
      if (activeEnvId === envId) refreshLog(envId);
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
