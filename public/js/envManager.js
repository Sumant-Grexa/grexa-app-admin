import { api } from "./api.js";

/* ── Add Environment Modal ─────────────────────────────────────────────────── */

export function initAddEnvModal(onSuccess) {
  const modal     = document.getElementById("add-env-modal");
  const form      = document.getElementById("add-env-form");
  const nameInput = document.getElementById("new-env-name");
  const subInput  = document.getElementById("new-env-subdomain");
  const errorEl   = document.getElementById("add-env-error");
  const submitBtn = document.getElementById("add-env-submit");

  function open() {
    form.reset();
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    submitBtn.disabled = false;
    submitBtn.textContent = "Add Environment";
    modal.classList.remove("hidden");
    nameInput.focus();
  }

  function close() {
    modal.classList.add("hidden");
  }

  document.getElementById("add-env-btn").addEventListener("click", open);
  document.getElementById("add-env-close").addEventListener("click", close);
  document.getElementById("add-env-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name      = nameInput.value.trim();
    const subdomain = subInput.value.trim();

    if (!name || !subdomain) {
      showError(errorEl, "Both fields are required.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Provisioning…";
    errorEl.classList.add("hidden");

    try {
      await api("POST", "/api/environments", { name, subdomain });
      close();
      if (onSuccess) onSuccess();
    } catch (err) {
      showError(errorEl, err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Add Environment";
    }
  });
}

/* ── Remove Environment Modal ──────────────────────────────────────────────── */

export function initRemoveEnvModal(onSuccess) {
  const modal    = document.getElementById("remove-env-modal");
  const labelEl  = document.getElementById("remove-env-label");
  const pwInput  = document.getElementById("remove-env-password");
  const errorEl  = document.getElementById("remove-env-error");
  const submitBtn = document.getElementById("remove-env-submit");

  let pendingEnvId = null;

  function open(envId, envLabel) {
    pendingEnvId = envId;
    labelEl.textContent = envLabel || envId;
    pwInput.value = "";
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    submitBtn.disabled = false;
    submitBtn.textContent = "Remove";
    modal.classList.remove("hidden");
    pwInput.focus();
  }

  function close() {
    modal.classList.add("hidden");
    pendingEnvId = null;
  }

  document.getElementById("remove-env-close").addEventListener("click", close);
  document.getElementById("remove-env-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  submitBtn.addEventListener("click", async () => {
    if (!pendingEnvId) return;
    const password = pwInput.value;

    if (!password) {
      showError(errorEl, "Password is required.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Removing…";
    errorEl.classList.add("hidden");

    try {
      await api("DELETE", `/api/environments/${pendingEnvId}`, { password });
      close();
      if (onSuccess) onSuccess();
    } catch (err) {
      showError(errorEl, err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Remove";
    }
  });

  return { open };
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
