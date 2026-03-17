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

/** Returns the currently selected branch value for an env. */
export function getBranchValue(envId) {
  return document.getElementById(`select-wrap-${envId}`)?.dataset.selected ?? "";
}

/**
 * Fills the custom dropdown options and pre-selects the current branch.
 * No restriction on redeploying the same branch.
 */
export function populateSelect(envId, { branches, current }, disabled = false) {
  const wrap = document.getElementById(`select-wrap-${envId}`);
  if (!wrap) return;

  const optsEl = document.getElementById(`options-${envId}`);
  optsEl.innerHTML = "";

  branches.forEach((b) => {
    const opt = document.createElement("div");
    opt.className = "branch-option" + (b === current ? " is-current" : "");
    opt.dataset.value = b;
    opt.textContent = b;
    optsEl.appendChild(opt);
  });

  // Pre-select current branch — deploy button enabled regardless
  if (current) {
    wrap.dataset.selected = current;
    const display = document.getElementById(`selector-display-${envId}`);
    if (display) display.textContent = current;
    // Mark selected
    Array.from(optsEl.children).forEach((o) =>
      o.classList.toggle("selected", o.dataset.value === current)
    );
  }

  const deployBtn = document.getElementById(`deploy-${envId}`);
  if (deployBtn) deployBtn.disabled = !wrap.dataset.selected || disabled;
}

/** Call once at init — closes any open dropdown when clicking outside. */
export function initDropdowns() {
  document.addEventListener("click", () => {
    document.querySelectorAll(".branch-dropdown:not(.hidden)").forEach((dd) =>
      dd.classList.add("hidden")
    );
  });
}

/**
 * @param {Record<string, any>} data
 * @param {Record<string, any>} branchCache
 * @param {{ onFetch, onDeploy, onViewLog }} callbacks
 */
export function renderEnvList(data, branchCache, { onFetch, onDeploy, onViewLog, onRemove }) {
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
        <div style="display:flex;align-items:center;gap:8px;">
          ${badgeHTML(deploy)}
          <button class="btn-remove-env" id="remove-${id}" title="Remove environment" aria-label="Remove ${esc(env.label)}">&#x2715;</button>
        </div>
      </div>

      <div class="env-row-actions">
        <div class="branch-selector-wrap" id="select-wrap-${id}" data-selected="">
          <button type="button" class="selector-trigger" id="selector-trigger-${id}" ${isDeploying ? "disabled" : ""}>
            <span class="selector-display" id="selector-display-${id}">— fetch branches —</span>
            <svg class="selector-caret" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="branch-dropdown hidden" id="dropdown-${id}">
            <div class="dropdown-search-wrap">
              <input type="text" class="dropdown-search" id="search-${id}" placeholder="Search branches..." autocomplete="off" spellcheck="false" />
            </div>
            <div class="dropdown-options" id="options-${id}"></div>
          </div>
        </div>

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

    // ── Dropdown wiring ────────────────────────────────────────────────────
    const trigger   = document.getElementById(`selector-trigger-${id}`);
    const dropdown  = document.getElementById(`dropdown-${id}`);
    const searchEl  = document.getElementById(`search-${id}`);
    const optsEl    = document.getElementById(`options-${id}`);
    const wrap      = document.getElementById(`select-wrap-${id}`);
    const deployBtn = document.getElementById(`deploy-${id}`);

    trigger.addEventListener("click", (e) => {
      e.stopPropagation(); // prevent global close listener from firing immediately
      // Close other open dropdowns
      document.querySelectorAll(".branch-dropdown:not(.hidden)").forEach((dd) => {
        if (dd !== dropdown) dd.classList.add("hidden");
      });
      dropdown.classList.toggle("hidden");
      if (!dropdown.classList.contains("hidden")) {
        searchEl.value = "";
        Array.from(optsEl.children).forEach((o) => (o.style.display = ""));
        searchEl.focus();
      }
    });

    // Prevent clicks inside dropdown from bubbling to global close listener
    dropdown.addEventListener("click", (e) => e.stopPropagation());

    // Real-time search filter
    searchEl.addEventListener("input", () => {
      const q = searchEl.value.toLowerCase();
      Array.from(optsEl.children).forEach((o) => {
        o.style.display = o.dataset.value.toLowerCase().includes(q) ? "" : "none";
      });
    });

    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dropdown.classList.add("hidden");
    });

    // Option click — no restriction, same branch can be redeployed
    optsEl.addEventListener("click", (e) => {
      const opt = e.target.closest(".branch-option");
      if (!opt) return;
      const val = opt.dataset.value;
      wrap.dataset.selected = val;
      document.getElementById(`selector-display-${id}`).textContent = val;
      dropdown.classList.add("hidden");
      Array.from(optsEl.children).forEach((o) =>
        o.classList.toggle("selected", o.dataset.value === val)
      );
      deployBtn.disabled = isDeploying; // only disabled if a deploy is running
    });

    // Fetch button
    document.getElementById(`fetch-${id}`)
      .addEventListener("click", () => onFetch(id));

    // Deploy button
    deployBtn.addEventListener("click", () => {
      const b = getBranchValue(id);
      if (b) onDeploy(id, b);
    });

    // Log button
    const logBtn = document.getElementById(`log-${id}`);
    if (logBtn) logBtn.addEventListener("click", () => onViewLog(id));

    // Remove button
    const removeBtn = document.getElementById(`remove-${id}`);
    if (removeBtn) removeBtn.addEventListener("click", () => onRemove && onRemove(id, env.label));

    // Restore cached branches across re-renders
    if (branchCache[id]) {
      populateSelect(id, branchCache[id], isDeploying);
    }
  }
}
