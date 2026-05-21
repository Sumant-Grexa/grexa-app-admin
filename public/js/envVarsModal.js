import { api } from "./api.js";

export function initEnvVarsModal() {
  const modal      = document.getElementById("env-vars-modal");
  const labelEl    = document.getElementById("env-vars-label");
  const pwInput    = document.getElementById("env-vars-password");
  const pwErrorEl  = document.getElementById("env-vars-password-error");
  const errorEl    = document.getElementById("env-vars-error");
  const devArea    = document.getElementById("env-vars-dev");
  const prodArea   = document.getElementById("env-vars-prod");
  const logWrap    = document.getElementById("env-vars-log-wrap");
  const logEl      = document.getElementById("env-vars-log");
  const loadBtn    = document.getElementById("env-vars-load");
  const saveBtn    = document.getElementById("env-vars-save");
  const tabs       = document.querySelectorAll(".env-tab");

  let currentEnvId = null;

  /* ── Tab switching ─────────────────────────────────────────────────────── */
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.dataset.tab;
      devArea.classList.toggle("hidden",  which !== "dev");
      prodArea.classList.toggle("hidden", which !== "prod");
    });
  });

  /* ── Helpers ───────────────────────────────────────────────────────────── */
  function clearState() {
    devArea.value  = "";
    prodArea.value = "";
    logWrap.classList.add("hidden");
    logEl.textContent = "";
    errorEl.classList.add("hidden");
    pwErrorEl.classList.add("hidden");
    pwErrorEl.textContent = "";
    errorEl.textContent = "";
    loadBtn.disabled = false;
    saveBtn.disabled = false;
    loadBtn.textContent = "Load";
    saveBtn.textContent = "Save & Run";
    // Reset to dev tab
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === "dev"));
    devArea.classList.remove("hidden");
    prodArea.classList.add("hidden");
  }

  function showLog(lines) {
    logEl.textContent = lines.join("\n");
    logWrap.classList.remove("hidden");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setError(el, msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  /* ── Open / close ──────────────────────────────────────────────────────── */
  function open(envId, envLabel) {
    currentEnvId = envId;
    labelEl.textContent = envLabel || envId;
    pwInput.value = "";
    clearState();
    modal.classList.remove("hidden");
    pwInput.focus();
  }

  function close() {
    modal.classList.add("hidden");
    currentEnvId = null;
  }

  document.getElementById("env-vars-close").addEventListener("click", close);
  document.getElementById("env-vars-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  /* ── Load ──────────────────────────────────────────────────────────────── */
  loadBtn.addEventListener("click", async () => {
    const password = pwInput.value;
    if (!password) { setError(pwErrorEl, "Password is required."); return; }

    pwErrorEl.classList.add("hidden");
    errorEl.classList.add("hidden");
    loadBtn.disabled = true;
    loadBtn.textContent = "Loading…";

    try {
      const data = await api("POST", `/api/environments/${currentEnvId}/env-vars/read`, { password });
      devArea.value  = data.devContent;
      prodArea.value = data.prodContent;
    } catch (err) {
      setError(err.message === "Wrong password" ? pwErrorEl : errorEl, err.message);
    } finally {
      loadBtn.disabled = false;
      loadBtn.textContent = "Load";
    }
  });

  /* ── Save & Run ────────────────────────────────────────────────────────── */
  saveBtn.addEventListener("click", async () => {
    const password = pwInput.value;
    if (!password) { setError(pwErrorEl, "Password is required."); return; }

    pwErrorEl.classList.add("hidden");
    errorEl.classList.add("hidden");
    logWrap.classList.add("hidden");
    saveBtn.disabled = true;
    saveBtn.textContent = "Running…";

    try {
      const res = await fetch(`/api/environments/${currentEnvId}/env-vars/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, devContent: devArea.value, prodContent: prodArea.value }),
      });
      const data = await res.json();

      if (res.status === 401) { setError(pwErrorEl, data.error || "Wrong password"); return; }
      if (data.log) showLog(data.log);
      if (!res.ok) setError(errorEl, data.error || "Save failed");
    } catch (err) {
      setError(errorEl, err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save & Run";
    }
  });

  return { open };
}
