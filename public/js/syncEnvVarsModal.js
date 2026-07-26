import {
  getAllDevEnvEntries,
  getFreshDevEnvEntries,
  runSyncForAllDevEnvs,
} from "./syncEnvVarsRunner.js";

function findDefaultReferenceEnvId(devEnvEntries) {
  const preprodWeb = devEnvEntries.find(([, env]) =>
    typeof env?.repoPath === "string" && /\/preprod-web\/?$/.test(env.repoPath)
  );
  if (preprodWeb) return preprodWeb[0];

  const preprod = devEnvEntries.find(([id]) => id === "preprod");
  if (preprod) return preprod[0];

  return devEnvEntries[0]?.[0] || "";
}

export function initSyncDevEnvModal(getStatusData, onSuccess) {
  const USE_PARALLEL_SYNC = true;
  const PARALLEL_SYNC_CONCURRENCY = 3;

  const modal = document.getElementById("sync-dev-envs-modal");
  const openBtn = document.getElementById("sync-dev-envs-btn");
  const closeBtn = document.getElementById("sync-dev-envs-close");
  const cancelBtn = document.getElementById("sync-dev-envs-cancel");
  const runBtn = document.getElementById("sync-dev-envs-run");
  const passwordInput = document.getElementById("sync-dev-envs-password");
  const passwordErrorEl = document.getElementById("sync-dev-envs-password-error");
  const referenceSelect = document.getElementById("sync-dev-envs-reference");
  const referenceHintEl = document.getElementById("sync-dev-envs-reference-hint");
  const errorEl = document.getElementById("sync-dev-envs-error");
  const logWrap = document.getElementById("sync-dev-envs-log-wrap");
  const logEl = document.getElementById("sync-dev-envs-log");
  const progressWrap = document.getElementById("sync-dev-envs-progress-wrap");
  const progressListEl = document.getElementById("sync-dev-envs-progress-list");

  const progressRows = {};

  function setError(el, msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function clearError(el) {
    el.textContent = "";
    el.classList.add("hidden");
  }

  function clearLog() {
    logWrap.classList.add("hidden");
    logEl.textContent = "";
  }

  function appendLogBlock(envId, lines) {
    if (!Array.isArray(lines) || !lines.length) return;
    const block = lines.map((line) => `[${envId}] ${line}`).join("\n");
    logEl.textContent = logEl.textContent ? `${logEl.textContent}\n${block}` : block;
    logWrap.classList.remove("hidden");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setRowStatus(envId, status, note = "") {
    const row = progressRows[envId];
    if (!row) return;
    row.badge.className = `sync-status-badge ${status}`;
    row.badge.textContent = status.toUpperCase();
    row.note.textContent = note;
  }

  function getStatusDataSafe() {
    return typeof getStatusData === "function" ? getStatusData() : {};
  }

  function renderProgressRows(devEnvEntries) {
    progressListEl.innerHTML = "";
    Object.keys(progressRows).forEach((k) => delete progressRows[k]);

    if (!devEnvEntries.length) {
      progressWrap.classList.add("hidden");
      return;
    }

    for (const [envId, env] of devEnvEntries) {
      const row = document.createElement("div");
      row.className = "sync-progress-row";
      row.innerHTML = `
        <span class="sync-progress-env">${env.label || envId} (${envId})</span>
        <span class="sync-status-badge pending">PENDING</span>
        <span class="sync-progress-note"></span>
      `;
      const badge = row.querySelector(".sync-status-badge");
      const note = row.querySelector(".sync-progress-note");
      progressRows[envId] = { row, badge, note };
      progressListEl.appendChild(row);
    }

    progressWrap.classList.remove("hidden");
  }

  async function populateReferenceOptions() {
    let devEnvEntries = getAllDevEnvEntries(getStatusDataSafe());
    try {
      devEnvEntries = await getFreshDevEnvEntries();
    } catch {
      // Fall back to cached status data if latest fetch fails.
    }

    referenceSelect.innerHTML = "";

    for (const [envId, env] of devEnvEntries) {
      const opt = document.createElement("option");
      opt.value = envId;
      opt.textContent = `${env.label || envId} (${envId})`;
      referenceSelect.appendChild(opt);
    }

    const defaultEnvId = findDefaultReferenceEnvId(devEnvEntries);
    if (defaultEnvId) referenceSelect.value = defaultEnvId;

    const defaultEnv = devEnvEntries.find(([envId]) => envId === defaultEnvId)?.[1];
    const defaultRepoName = typeof defaultEnv?.repoPath === "string"
      ? defaultEnv.repoPath.split("/").filter(Boolean).pop()
      : "";

    referenceHintEl.textContent = defaultEnvId
      ? `Default reference: ${defaultRepoName || defaultEnvId}`
      : "No dev environments available.";

    renderProgressRows(devEnvEntries);
    runBtn.disabled = !defaultEnvId;
  }

  async function open() {
    passwordInput.value = "";
    clearError(passwordErrorEl);
    clearError(errorEl);
    clearLog();
    runBtn.disabled = false;
    runBtn.textContent = "Sync All & Run";
    await populateReferenceOptions();
    modal.classList.remove("hidden");
    passwordInput.focus();
  }

  function close() {
    modal.classList.add("hidden");
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  runBtn.addEventListener("click", async () => {
    const password = passwordInput.value;
    const sourceEnvId = referenceSelect.value;

    if (!password) {
      setError(passwordErrorEl, "Password is required.");
      return;
    }
    if (!sourceEnvId) {
      setError(errorEl, "Select a reference environment.");
      return;
    }

    clearError(passwordErrorEl);
    clearError(errorEl);
    clearLog();
    renderProgressRows([]);
    runBtn.disabled = true;
    runBtn.textContent = "Syncing…";

    let result;
    try {
      result = await runSyncForAllDevEnvs({
        password,
        sourceEnvId,
        parallel: USE_PARALLEL_SYNC,
        concurrency: PARALLEL_SYNC_CONCURRENCY,
        onTargetsResolved: (devEnvEntries) => renderProgressRows(devEnvEntries),
        onStart: (envId) => setRowStatus(envId, "ongoing", "Running build_runner..."),
        onSuccess: (envId) => setRowStatus(envId, "done", "Synced successfully"),
        onFailed: (envId, reason) => setRowStatus(envId, "failed", reason),
        onLog: (envId, lines) => appendLogBlock(envId, lines),
      });
    } catch (err) {
      setError(errorEl, err instanceof Error ? err.message : String(err));
      runBtn.disabled = false;
      runBtn.textContent = "Sync All & Run";
      return;
    }

    if (result.total === 0) {
      setError(errorEl, "No dev environments available.");
    } else if (result.aborted && result.fatalError) {
      setError(passwordErrorEl, result.fatalError);
    } else if (result.failed > 0) {
      setError(errorEl, `${result.failed}/${result.total} environment(s) failed.`);
    }

    if (result.done > 0 && typeof onSuccess === "function") {
      await onSuccess();
    }

    runBtn.disabled = false;
    runBtn.textContent = "Sync All & Run";
  });
}
