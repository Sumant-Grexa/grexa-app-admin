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

  if (current) {
    wrap.dataset.selected = current;
    const display = document.getElementById(`selector-display-${envId}`);
    if (display) display.textContent = current;
    Array.from(optsEl.children).forEach((o) =>
      o.classList.toggle("selected", o.dataset.value === current)
    );
  }

  const deployBtn = document.getElementById(`deploy-${envId}`);
  if (deployBtn) deployBtn.disabled = !wrap.dataset.selected || disabled;
}

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
 * @param {{ onFetch, onDeploy, onViewLog, onRemove, onEnvVars }} callbacks
 */
export function renderEnvList(data, branchCache, { onFetch, onDeploy, onViewLog, onRemove, onEnvVars }) {
  const list = document.getElementById("env-list");
  list.innerHTML = "";

  for (const [id, env] of Object.entries(data)) {
    const deploy = env.deploy;
    const isDeploying = deploy?.status === "deploying";
    const branch = env.currentBranch || "unknown";

    const card = document.createElement("div");
    card.className = `env-card ${stateClass(deploy)}`;
    card.id = `item-${id}`;

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-row">
          <span class="env-name">${esc(env.label)}</span>
          ${badgeHTML(deploy)}
        </div>
        <div class="card-actions-top">
          <button class="btn-env-vars" id="envvars-${id}" title="Edit .env files">.env</button>
          <button class="btn-remove-env" id="remove-${id}" title="Remove environment" aria-label="Remove ${esc(env.label)}">&#x2715;</button>
        </div>
      </div>

      <div class="card-branch-row">
        <svg class="card-branch-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="5" cy="4" r="1.5" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="11" cy="4" r="1.5" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="5" cy="12" r="1.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M5 5.5v5M11 5.5c0 2-1.5 4-6 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span class="card-branch" id="branch-live-${id}" title="${esc(branch)}">${esc(branch)}</span>
      </div>

      <div class="card-commit-row">
        ${env.lastCommit ? `
          <svg class="card-author-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.4"/>
            <path d="M2.5 13c0-3 2-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <span class="card-author" title="${esc(env.lastCommit.author)}">${esc(env.lastCommit.author)}</span>
          <span class="card-dot">·</span>
          <span class="card-hash">${esc(env.lastCommit.hash)}</span>
        ` : ""}
      </div>

      <div class="card-time">
        ${deploy
        ? deploy.status === "deploying"
          ? `<span class="time-deploying">⬤ Deploying · started ${timeAgo(deploy.startedAt)}</span>`
          : `Last deploy <strong>${timeAgo(deploy.finishedAt)}</strong>`
        : '<span class="time-none">No deploys yet</span>'}
      </div>

      <div class="card-deploy-row">
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
      </div>

      <div class="card-footer-row">
        <label class="build-runner-label" title="Run dart run build_runner clean + build before flutter build">
          <input type="checkbox" id="build-runner-${id}" class="build-runner-checkbox" ${isDeploying ? "disabled" : ""} />
          build_runner
        </label>
        <div class="card-footer-right">
          ${deploy ? `<button class="btn-view-log" id="log-${id}">Log</button>` : ""}
          <button class="btn-deploy" id="deploy-${id}" disabled>
            ${isDeploying ? "Deploying…" : "Deploy"}
          </button>
        </div>
      </div>
    `;

    list.appendChild(card);

    // ── Dropdown wiring ──────────────────────────────────────────────────────
    const trigger = document.getElementById(`selector-trigger-${id}`);
    const dropdown = document.getElementById(`dropdown-${id}`);
    const searchEl = document.getElementById(`search-${id}`);
    const optsEl = document.getElementById(`options-${id}`);
    const wrap = document.getElementById(`select-wrap-${id}`);
    const deployBtn = document.getElementById(`deploy-${id}`);

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
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

    dropdown.addEventListener("click", (e) => e.stopPropagation());

    searchEl.addEventListener("input", () => {
      const q = searchEl.value.toLowerCase();
      Array.from(optsEl.children).forEach((o) => {
        o.style.display = o.dataset.value.toLowerCase().includes(q) ? "" : "none";
      });
    });

    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dropdown.classList.add("hidden");
    });

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
      deployBtn.disabled = isDeploying;
    });

    document.getElementById(`fetch-${id}`)
      .addEventListener("click", () => onFetch(id));

    deployBtn.addEventListener("click", () => {
      const b = getBranchValue(id);
      const runBuildRunner = document.getElementById(`build-runner-${id}`)?.checked ?? false;
      if (b) onDeploy(id, b, runBuildRunner);
    });

    const logBtn = document.getElementById(`log-${id}`);
    if (logBtn) logBtn.addEventListener("click", () => onViewLog(id));

    const removeBtn = document.getElementById(`remove-${id}`);
    if (removeBtn) removeBtn.addEventListener("click", () => onRemove && onRemove(id, env.label));

    const envVarsBtn = document.getElementById(`envvars-${id}`);
    if (envVarsBtn) envVarsBtn.addEventListener("click", () => onEnvVars && onEnvVars(id, env.label));

    if (branchCache[id]) {
      populateSelect(id, branchCache[id], isDeploying);
    }
  }
}
