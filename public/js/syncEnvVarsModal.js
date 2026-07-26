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

  function setError(el, msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function clearError(el) {
    el.textContent = "";
    el.classList.add("hidden");
  }

  function showLog(lines) {
    logEl.textContent = lines.join("\n");
    logWrap.classList.remove("hidden");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function getDevEnvEntries() {
    const statusData = typeof getStatusData === "function" ? getStatusData() : {};
    return Object.entries(statusData || {}).filter(([, env]) => env?.flavor === "dev");
  }

  function populateReferenceOptions() {
    const devEnvEntries = getDevEnvEntries();
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

    runBtn.disabled = !defaultEnvId;
  }

  function open() {
    passwordInput.value = "";
    clearError(passwordErrorEl);
    clearError(errorEl);
    logWrap.classList.add("hidden");
    logEl.textContent = "";
    runBtn.disabled = false;
    runBtn.textContent = "Sync All & Run";
    populateReferenceOptions();
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
    const referenceEnvId = referenceSelect.value;

    if (!password) {
      setError(passwordErrorEl, "Password is required.");
      return;
    }
    if (!referenceEnvId) {
      setError(errorEl, "Select a reference environment.");
      return;
    }

    clearError(passwordErrorEl);
    clearError(errorEl);
    logWrap.classList.add("hidden");
    runBtn.disabled = true;
    runBtn.textContent = "Syncing…";

    try {
      const res = await fetch("/api/environments/env-vars/sync-dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, referenceEnvId }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (res.status === 401) {
        setError(passwordErrorEl, data.error || "Wrong password");
        return;
      }

      if (Array.isArray(data.log)) showLog(data.log);

      if (!res.ok || data.ok === false) {
        setError(errorEl, data.error || "Sync failed");
        return;
      }

      if (typeof onSuccess === "function") await onSuccess();
    } catch (err) {
      setError(errorEl, err instanceof Error ? err.message : String(err));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "Sync All & Run";
    }
  });
}
