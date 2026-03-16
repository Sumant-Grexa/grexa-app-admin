/* ── State ─────────────────────────────────────────────────────────────────── */
let statusData = {};
let logPollers = {};
let activeLogEnv = null;

/* ── API helpers ───────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ── Auth ──────────────────────────────────────────────────────────────────── */
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = document.getElementById("password-input").value;
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  try {
    await api("POST", "/api/login", { password: pw });
    showApp();
  } catch {
    errEl.classList.remove("hidden");
    document.getElementById("password-input").select();
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("POST", "/api/logout");
  location.reload();
});

async function checkAuth() {
  try {
    const me = await api("GET", "/api/me");
    if (me.authenticated) showApp();
    else showLogin();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
}

function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  loadStatus();
}

/* ── Status loading ────────────────────────────────────────────────────────── */
document.getElementById("refresh-btn").addEventListener("click", loadStatus);

async function loadStatus() {
  try {
    statusData = await api("GET", "/api/status");
    renderEnvCards(statusData);
    updateHeaderDot();
  } catch (err) {
    console.error("Status fetch failed:", err);
  }
}

function updateHeaderDot() {
  const dot = document.getElementById("header-status-dot");
  const deploying = Object.values(statusData).some(
    (e) => e.deploy && e.deploy.status === "deploying"
  );
  dot.className = "status-dot " + (deploying ? "deploying" : "idle");
}

/* ── Render env cards ──────────────────────────────────────────────────────── */
const ENV_ICONS = { preprod: "🧪", bira: "🌿" };

function cardStateClass(deploy) {
  if (!deploy) return "";
  return deploy.status + "-state";
}

function badgeHTML(deploy) {
  if (!deploy) return `<span class="deploy-badge idle">IDLE</span>`;
  const map = {
    deploying: "DEPLOYING…",
    success: "LIVE",
    error: "FAILED",
  };
  return `<span class="deploy-badge ${deploy.status}">${
    map[deploy.status] || deploy.status.toUpperCase()
  }</span>`;
}

function renderEnvCards(data) {
  const grid = document.getElementById("env-grid");
  grid.innerHTML = "";

  for (const [id, env] of Object.entries(data)) {
    const deploy = env.deploy;
    const isDeploying = deploy && deploy.status === "deploying";
    const branch = env.currentBranch || "unknown";

    const card = document.createElement("div");
    card.className = `env-card ${cardStateClass(deploy)}`;
    card.id = `card-${id}`;

    card.innerHTML = `
      <div class="card-header">
        <div class="card-identity">
          <div class="env-icon">${ENV_ICONS[id] || "📦"}</div>
          <div>
            <div class="env-name">${env.label}</div>
            <div class="env-subdomain">${env.subdomain}</div>
          </div>
        </div>
        ${badgeHTML(deploy)}
      </div>

      <div class="card-body">
        <div class="current-branch-block">
          <div>
            <div class="cb-label">Live Branch</div>
            <div class="cb-value" id="branch-live-${id}">${branch}</div>
          </div>
        </div>

        <div class="branch-selector">
          <div class="selector-label">Deploy a branch</div>
          <div class="branch-select-wrap">
            <select class="branch-select" id="select-${id}" ${isDeploying ? "disabled" : ""}>
              <option value="">— fetch branches —</option>
            </select>
            <button class="btn-fetch" id="fetch-${id}" ${isDeploying ? "disabled" : ""}>
              ⇩ Fetch
            </button>
          </div>
          <button class="btn-deploy" id="deploy-${id}" disabled>
            ${isDeploying ? "⏳ Deploying…" : "🚀 Deploy"}
          </button>
        </div>
      </div>

      <div class="card-footer">
        <span class="footer-meta">
          ${
            deploy
              ? deploy.status === "deploying"
                ? `Started ${timeAgo(deploy.startedAt)}`
                : `Last deploy: <strong>${timeAgo(deploy.finishedAt)}</strong>`
              : "No deploy yet"
          }
        </span>
        ${
          deploy
            ? `<button class="btn-view-log" data-env="${id}">View Log</button>`
            : ""
        }
      </div>
    `;

    grid.appendChild(card);

    // Wire fetch button
    document.getElementById(`fetch-${id}`).addEventListener("click", () =>
      fetchBranches(id)
    );

    // Wire select → enable deploy
    document.getElementById(`select-${id}`).addEventListener("change", (e) => {
      const btn = document.getElementById(`deploy-${id}`);
      btn.disabled = !e.target.value || isDeploying;
    });

    // Wire deploy button
    document.getElementById(`deploy-${id}`).addEventListener("click", () => {
      const branch = document.getElementById(`select-${id}`).value;
      if (branch) deployBranch(id, branch);
    });

    // Wire view log
    const logBtn = card.querySelector(".btn-view-log");
    if (logBtn) {
      logBtn.addEventListener("click", () => openLog(logBtn.dataset.env));
    }

    // If currently deploying, resume polling
    if (isDeploying) startLogPolling(id);
  }
}

/* ── Fetch branches ────────────────────────────────────────────────────────── */
async function fetchBranches(envId) {
  const sel = document.getElementById(`select-${envId}`);
  const btn = document.getElementById(`fetch-${envId}`);
  sel.innerHTML = `<option>Fetching…</option>`;
  btn.disabled = true;

  try {
    const data = await api("GET", `/api/branches/${envId}`);
    sel.innerHTML = `<option value="">— select branch —</option>`;
    data.branches.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      if (b === data.current) opt.textContent += " ✓";
      sel.appendChild(opt);
    });
    // pre-select current
    if (data.current) sel.value = data.current;
    document.getElementById(`deploy-${envId}`).disabled = !sel.value;
  } catch (err) {
    sel.innerHTML = `<option>Error: ${err.message}</option>`;
  } finally {
    btn.disabled = false;
  }
}

/* ── Deploy ────────────────────────────────────────────────────────────────── */
async function deployBranch(envId, branch) {
  const liveEnv = statusData[envId];
  const confirmMsg = `Deploy "${branch}" to ${liveEnv?.label || envId}?\n\nThis will run flutter build and replace the nginx content.`;
  if (!confirm(confirmMsg)) return;

  try {
    await api("POST", "/api/deploy", { envId, branch });
    loadStatus(); // re-render to deploying state
    setTimeout(() => {
      openLog(envId);
      startLogPolling(envId);
    }, 300);
  } catch (err) {
    alert("Deploy failed to start: " + err.message);
  }
}

/* ── Log panel ─────────────────────────────────────────────────────────────── */
document.getElementById("close-log").addEventListener("click", () => {
  document.getElementById("log-panel").classList.add("hidden");
  activeLogEnv = null;
});

function openLog(envId) {
  activeLogEnv = envId;
  document.getElementById("log-title").textContent = `Deploy Log — ${
    statusData[envId]?.label || envId
  }`;
  document.getElementById("log-panel").classList.remove("hidden");
  refreshLog(envId);
}

async function refreshLog(envId) {
  try {
    const data = await api("GET", `/api/deploy-log/${envId}`);
    const out = document.getElementById("log-output");
    out.innerHTML = data.log
      .map((line) => {
        if (line.startsWith("✅")) return `<span class="log-line-ok">${esc(line)}</span>`;
        if (line.startsWith("❌")) return `<span class="log-line-err">${esc(line)}</span>`;
        if (line.startsWith("▶")) return `<span class="log-line-step">${esc(line)}</span>`;
        return `<span class="log-line-plain">${esc(line)}</span>`;
      })
      .join("\n");
    out.scrollTop = out.scrollHeight;
  } catch {}
}

function startLogPolling(envId) {
  if (logPollers[envId]) return;
  logPollers[envId] = setInterval(async () => {
    try {
      const data = await api("GET", `/api/deploy-log/${envId}`);
      if (activeLogEnv === envId) refreshLog(envId);
      if (data.status !== "deploying") {
        clearInterval(logPollers[envId]);
        delete logPollers[envId];
        loadStatus();
      }
    } catch {
      clearInterval(logPollers[envId]);
      delete logPollers[envId];
    }
  }, 1500);
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function esc(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/* ── Init ──────────────────────────────────────────────────────────────────── */
checkAuth();

// Auto-refresh status every 30s
setInterval(() => {
  if (!document.getElementById("app-screen").classList.contains("hidden")) {
    loadStatus();
  }
}, 30_000);
