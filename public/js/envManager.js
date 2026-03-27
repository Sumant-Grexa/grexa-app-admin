import { api } from "./api.js";

const ID_RE  = /^[a-z0-9][a-z0-9-]*$/;
const SUB_RE = /^[a-z0-9][a-z0-9-]*$/;

function validateName(v) {
  if (!v) return "Name is required.";
  if (/[A-Z]/.test(v)) return "Uppercase letters are not allowed — use lowercase only.";
  if (/\s/.test(v))    return "Spaces are not allowed — use hyphens instead.";
  if (!ID_RE.test(v))  return "Only lowercase letters, numbers, and hyphens allowed. Must start with a letter or number.";
  return null;
}

function validateSubdomain(v) {
  if (!v) return "Subdomain is required.";
  if (v.includes(".")) return "Enter only the subdomain part (e.g. hoegarden, not hoegarden.grexa.ai).";
  if (/[A-Z]/.test(v)) return "Uppercase letters are not allowed.";
  if (/\s/.test(v))    return "Spaces are not allowed.";
  if (!SUB_RE.test(v)) return "Only lowercase letters, numbers, and hyphens allowed. Must start with a letter or number.";
  return null;
}

/* ── Add Environment Modal ─────────────────────────────────────────────────── */

export function initAddEnvModal(onSuccess) {
  const modal        = document.getElementById("add-env-modal");
  const form         = document.getElementById("add-env-form");
  const nameInput    = document.getElementById("new-env-name");
  const subInput     = document.getElementById("new-env-subdomain");
  const nameErrorEl  = document.getElementById("name-field-error");
  const subErrorEl   = document.getElementById("subdomain-field-error");
  const errorEl      = document.getElementById("add-env-error");
  const submitBtn    = document.getElementById("add-env-submit");

  function clearFieldError(el) {
    el.textContent = "";
    el.classList.add("hidden");
  }

  function setFieldError(el, msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function open() {
    form.reset();
    clearFieldError(nameErrorEl);
    clearFieldError(subErrorEl);
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

  // Real-time validation
  nameInput.addEventListener("input", () => {
    const err = validateName(nameInput.value.trim());
    err ? setFieldError(nameErrorEl, err) : clearFieldError(nameErrorEl);
  });

  subInput.addEventListener("input", () => {
    const err = validateSubdomain(subInput.value.trim());
    err ? setFieldError(subErrorEl, err) : clearFieldError(subErrorEl);
  });

  document.getElementById("add-env-btn").addEventListener("click", open);
  document.getElementById("add-env-close").addEventListener("click", close);
  document.getElementById("add-env-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name      = nameInput.value.trim();
    const subdomain = subInput.value.trim();

    const nameErr = validateName(name);
    const subErr  = validateSubdomain(subdomain);

    nameErr ? setFieldError(nameErrorEl, nameErr) : clearFieldError(nameErrorEl);
    subErr  ? setFieldError(subErrorEl, subErr)   : clearFieldError(subErrorEl);

    if (nameErr || subErr) return;

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
