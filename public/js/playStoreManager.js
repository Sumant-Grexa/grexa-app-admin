import { startRelease, getReleaseLog } from "./playStoreApi.js";

/* ── Module-level state ─────────────────────────────────────────────────────── */
let pollInterval = null;

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function setStatusBadge(status) {
  const badge = document.getElementById("ps-status-badge");
  if (!badge) return;

  badge.className = "deploy-badge";

  switch (status) {
    case "idle":
      badge.classList.add("idle");
      badge.textContent = "IDLE";
      break;
    case "running":
      badge.classList.add("deploying");
      badge.textContent = "RELEASING";
      break;
    case "success":
      badge.classList.add("success");
      badge.textContent = "SUCCESS";
      break;
    case "error":
      badge.classList.add("error");
      badge.textContent = "ERROR";
      break;
    default:
      badge.classList.add("idle");
      badge.textContent = "IDLE";
  }
}

function setButtonRunning(running) {
  const btn = document.getElementById("ps-release-btn");
  if (!btn) return;
  if (running) {
    btn.disabled = true;
    btn.textContent = "Releasing…";
  } else {
    btn.disabled = false;
    btn.textContent = "⚠ Release";
  }
}

function showError(msg) {
  const el = document.getElementById("ps-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError() {
  const el = document.getElementById("ps-error");
  if (el) el.classList.add("hidden");
}

function stopPolling() {
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function startPolling() {
  stopPolling();

  const logOutput = document.getElementById("ps-log-output");

  pollInterval = setInterval(async () => {
    try {
      const data = await getReleaseLog();
      const lines = Array.isArray(data.log) ? data.log : [];
      if (logOutput) {
        logOutput.textContent = lines.join("\n");
        logOutput.scrollTop = logOutput.scrollHeight;
      }

      if (data.status === "success" || data.status === "error") {
        stopPolling();
        setStatusBadge(data.status);
        setButtonRunning(false);
      }
    } catch (err) {
      // keep polling on transient errors
      console.error("Poll error:", err);
    }
  }, 2000);
}

/* ── Init ───────────────────────────────────────────────────────────────────── */
export function initPlayStoreManager() {
  /* Android checkbox → show/hide android fields */
  const androidCheckbox = document.getElementById("ps-android");
  const androidFields = document.getElementById("ps-android-fields");
  if (androidCheckbox && androidFields) {
    androidCheckbox.addEventListener("change", () => {
      if (androidCheckbox.checked) {
        androidFields.classList.remove("hidden");
      } else {
        androidFields.classList.add("hidden");
      }
    });
  }

  /* iOS checkbox → show/hide iOS fields */
  const iosCheckbox = document.getElementById("ps-ios");
  const iosFields = document.getElementById("ps-ios-fields");
  if (iosCheckbox && iosFields) {
    iosCheckbox.addEventListener("change", () => {
      if (iosCheckbox.checked) {
        iosFields.classList.remove("hidden");
      } else {
        iosFields.classList.add("hidden");
      }
    });
  }

  /* Rollout slider → live label update */
  const rolloutSlider = document.getElementById("ps-rollout");
  const rolloutLabel = document.getElementById("ps-rollout-label");
  if (rolloutSlider && rolloutLabel) {
    rolloutSlider.addEventListener("input", () => {
      rolloutLabel.textContent = rolloutSlider.value + "%";
    });
  }

  /* Form submit */
  const form = document.getElementById("ps-release-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    /* Collect platforms */
    const platforms = [];
    if (androidCheckbox && androidCheckbox.checked) platforms.push("android");
    if (iosCheckbox && iosCheckbox.checked) platforms.push("ios");

    /* Build payload */
    const releasePassword = (document.getElementById("ps-password")?.value || "").trim();
    const releaseNotes = (document.getElementById("ps-notes")?.value || "").trim();

    const payload = { releasePassword, platforms, releaseNotes };

    /* Android-specific fields */
    if (platforms.includes("android")) {
      const track = document.getElementById("ps-track")?.value || "production";
      const releaseName = (document.getElementById("ps-release-name")?.value || "").trim();
      const userFractionRaw = document.getElementById("ps-rollout")?.value;
      const userFraction = userFractionRaw ? parseInt(userFractionRaw, 10) : 10;
      payload.android = { track, releaseName, userFraction };
    }

    /* iOS-specific fields */
    if (platforms.includes("ios")) {
      const rolloutTypeEl = document.querySelector("input[name='ios-rollout-type']:checked");
      const rolloutType = rolloutTypeEl ? rolloutTypeEl.value : "full";
      payload.ios = { rolloutType };
    }

    /* Show log wrap, set running state */
    const logWrap = document.getElementById("ps-log-wrap");
    if (logWrap) logWrap.classList.remove("hidden");

    setStatusBadge("running");
    setButtonRunning(true);

    try {
      await startRelease(payload);
      startPolling();
    } catch (err) {
      showError(err.message || "Failed to start release");
      setStatusBadge("error");
      setButtonRunning(false);
    }
  });
}

/* ── Auto-init (module scripts are deferred, DOM is ready) ──────────────────── */
initPlayStoreManager();
