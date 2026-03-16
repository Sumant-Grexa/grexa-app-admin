export function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function badgeHTML(deploy) {
  if (!deploy) return `<span class="deploy-badge idle">IDLE</span>`;
  const labels = { deploying: "DEPLOYING", success: "LIVE", error: "FAILED" };
  return `<span class="deploy-badge ${deploy.status}">${labels[deploy.status] ?? deploy.status.toUpperCase()}</span>`;
}

function stateClass(deploy) {
  return deploy ? `${deploy.status}-state` : "";
}

export function updateHeaderDot(deploying) {
  const dot = document.getElementById("header-status-dot");
  dot.className = "status-dot " + (deploying ? "deploying" : "idle");
}

export function populateSelect(envId, { branches, current }, disabled = false) {
  const sel = document.getElementById(`select-${envId}`);
  if (!sel) return;
  sel.innerHTML = `<option value="">— select branch —</option>`;
  branches.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    opt.textContent = b + (b === current ? " ✓" : "");
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
  const deployBtn = document.getElementById(`deploy-${envId}`);
  if (deployBtn) deployBtn.disabled = !sel.value || disabled;
}

/**
 * @param {Record<string, any>} data - status data from /api/status
 * @param {Record<string, any>} branchCache - cached branch lists per envId
 * @param {{ onFetch, onDeploy, onViewLog }} callbacks
 */
export function renderEnvList(data, branchCache, { onFetch, onDeploy, onViewLog }) {
  const list = document.getElementById("env-list");
  list.innerHTML = "";

  for (const [id, env] of Object.entries(data)) {
    const deploy = env.deploy;
    const isDeploying = deploy?.status === "deploying";
    const branch = env.currentBranch || "unknown";

    const item = document.createElement("div");
    item.className = `env-item ${stateClass(deploy)}`;
    item.id = `item-${id}`;

    item.innerHTML = `
      <div class="env-row-top">
        <div class="env-info">
          <span class="env-name">${env.label}</span>
          <span class="env-sep">·</span>
          <span class="env-subdomain">${env.subdomain}</span>
          <span class="env-sep">·</span>
          <span class="env-current-branch" id="branch-live-${id}">${branch}</span>
        </div>
        ${badgeHTML(deploy)}
      </div>

      <div class="env-row-actions">
        <select class="branch-select" id="select-${id}" ${isDeploying ? "disabled" : ""}>
          <option value="">— fetch branches —</option>
        </select>
        <button class="btn-fetch" id="fetch-${id}" ${isDeploying ? "disabled" : ""}>Fetch</button>
        <div class="btn-action-sep"></div>
        <button class="btn-deploy" id="deploy-${id}" disabled>
          ${isDeploying ? "Deploying..." : "Deploy"}
        </button>
        ${deploy ? `<button class="btn-view-log" id="log-${id}">Log</button>` : ""}
      </div>

      <div class="env-row-footer">
        <span class="footer-meta">
          ${deploy
            ? deploy.status === "deploying"
              ? `Started ${timeAgo(deploy.startedAt)}`
              : `Last: <strong>${timeAgo(deploy.finishedAt)}</strong>`
            : "No deploys yet"}
        </span>
      </div>
    `;

    list.appendChild(item);

    document.getElementById(`fetch-${id}`)
      .addEventListener("click", () => onFetch(id));

    document.getElementById(`select-${id}`)
      .addEventListener("change", (e) => {
        document.getElementById(`deploy-${id}`).disabled = !e.target.value || isDeploying;
      });

    document.getElementById(`deploy-${id}`)
      .addEventListener("click", () => {
        const b = document.getElementById(`select-${id}`).value;
        if (b) onDeploy(id, b);
      });

    const logBtn = document.getElementById(`log-${id}`);
    if (logBtn) logBtn.addEventListener("click", () => onViewLog(id));

    // Restore cached branches so re-renders don't wipe the dropdown
    if (branchCache[id]) {
      populateSelect(id, branchCache[id], isDeploying);
    }
  }
}
