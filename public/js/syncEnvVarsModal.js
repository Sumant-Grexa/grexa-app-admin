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

  async function notifyWhenDone(result) {
    if (!("Notification" in window)) return;

    const title = result.failed === 0
      ? "Env sync completed"
      : "Env sync completed with failures";
    const body = `${result.done}/${result.total} succeeded${result.failed ? `, ${result.failed} failed` : ""}`;

    if (Notification.permission === "granted") {
      new Notification(title, { body });
      return;
    }

    if (Notification.permission === "default") {
      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          new Notification(title, { body });
        }
      } catch {
        // Ignore notification errors.
      }
    }
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

    const runningLines = lines.filter((line) => String(line).startsWith("→ Running: "));
    if (runningLines.length) {
      setRowCommand(envId, runningLines[runningLines.length - 1]);
    }
  }

  function setRowStatus(envId, status, note = "") {
    const row = progressRows[envId];
    if (!row) return;
    row.badge.className = `sync-status-badge ${status}`;
    row.badge.textContent = status.toUpperCase();
    row.note.textContent = note;
  }

  function setRowCommand(envId, command = "") {
    const row = progressRows[envId];
    if (!row) return;
    row.command.textContent = command;
  }

  function getStatusDataSafe() {
    return typeof getStatusData === "function" ? getStatusData() : {};
  }

  function renderProgressRows(devEnvEntries, targetEnvIds = [], sourceEnvId = "") {
    progressListEl.innerHTML = "";
    Object.keys(progressRows).forEach((k) => delete progressRows[k]);

    if (!devEnvEntries.length) {
      progressWrap.classList.add("hidden");
      return;
    }

    for (const [envId, env] of devEnvEntries) {
      const isSourceEnv = envId === sourceEnvId;
      const isTarget = targetEnvIds.includes(envId);
      const row = document.createElement("div");
      row.className = "sync-progress-row";
      row.innerHTML = `
        <div class="sync-progress-top">
          <span class="sync-progress-env">${env.label || envId} (${envId})</span>
          <span class="sync-status-badge pending">PENDING</span>
        </div>
        <div class="sync-progress-command">Waiting...</div>
        <div class="sync-progress-note"></div>
      `;
      const badge = row.querySelector(".sync-status-badge");
      const command = row.querySelector(".sync-progress-command");
      const note = row.querySelector(".sync-progress-note");
      progressRows[envId] = { row, badge, command, note };
      progressListEl.appendChild(row);

      if (isSourceEnv) {
        setRowStatus(envId, "skipped", "Reference env (not synced)");
        setRowCommand(envId, "Skipped");
      } else if (!isTarget) {
        setRowStatus(envId, "skipped", "Not in target set");
        setRowCommand(envId, "Skipped");
      } else {
        setRowStatus(envId, "pending", "Waiting to start");
        setRowCommand(envId, "Waiting...");
      }
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

    renderProgressRows(
      devEnvEntries,
      devEnvEntries.map(([envId]) => envId).filter((envId) => envId !== defaultEnvId),
      defaultEnvId
    );
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
    renderProgressRows([], [], sourceEnvId);
    runBtn.disabled = true;
    runBtn.textContent = "Syncing…";

    let result;
    try {
      result = await runSyncForAllDevEnvs({
        password,
        sourceEnvId,
        parallel: USE_PARALLEL_SYNC,
        concurrency: PARALLEL_SYNC_CONCURRENCY,
        onTargetsResolved: ({ devEnvEntries, targetEnvIds, sourceEnvId: resolvedSourceEnvId }) => {
          renderProgressRows(devEnvEntries, targetEnvIds, resolvedSourceEnvId);
        },
        onStart: (envId) => {
          setRowStatus(envId, "ongoing", "Running...");
          setRowCommand(envId, "Starting...");
        },
        onSuccess: (envId) => {
          setRowStatus(envId, "done", "Synced successfully");
          setRowCommand(envId, "Completed");
        },
        onFailed: (envId, reason) => {
          setRowStatus(envId, "failed", reason);
          setRowCommand(envId, "Failed");
        },
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

    await notifyWhenDone(result);

    runBtn.disabled = false;
    runBtn.textContent = "Sync All & Run";
  });
}
