import { startRelease, getReleaseLog } from "./playStoreApi.js";
import { openReleaseLog, startReleaseLogPolling } from "./log.js";

/* ── Module-level state ─────────────────────────────────────────────────────── */
let releaseLogPollActive = false;

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

function startPolling(version) {
  if (releaseLogPollActive) return;
  releaseLogPollActive = true;

  openReleaseLog(version ? `App Release v${version}` : "App Release").catch(() => {});

  startReleaseLogPolling(async (data) => {
    releaseLogPollActive = false;
    const finalData = data || (await getReleaseLog().catch(() => null));
    setStatusBadge(finalData?.status || "error");
    setButtonRunning(false);
  });
}

/* ── Init ───────────────────────────────────────────────────────────────────── */
export function initPlayStoreManager() {
  /* Release App modal open/close */
  const modal = document.getElementById("release-app-modal");
  document.getElementById("release-app-btn")?.addEventListener("click", async () => {
    modal?.classList.remove("hidden");
    try {
      const data = await getReleaseLog();
      setStatusBadge(data.status || "idle");
      if (data.status === "running") {
        setButtonRunning(true);
        startPolling();
      } else {
        setButtonRunning(false);
      }
      if (Array.isArray(data.log) && data.log.length > 0) {
        await openReleaseLog("App Release");
      }
    } catch {
      setStatusBadge("idle");
      setButtonRunning(false);
    }
  });
  document.getElementById("release-app-close")?.addEventListener("click", () => {
    modal?.classList.add("hidden");
  });
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

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
    const version = (document.getElementById("ps-version")?.value || "").trim();
    const releaseNotes = (document.getElementById("ps-notes")?.value || "").trim();

    if (!version) {
      showError("Version is required");
      return;
    }

    const payload = { releasePassword, version, platforms, releaseNotes };

    /* Android-specific fields */
    if (platforms.includes("android")) {
      const track = document.getElementById("ps-track")?.value || "production";
      const userFractionRaw = document.getElementById("ps-rollout")?.value;
      const userFraction = userFractionRaw ? parseInt(userFractionRaw, 10) : 10;
      payload.android = { track, userFraction };
    }

    /* iOS-specific fields */
    if (platforms.includes("ios")) {
      const rolloutTypeEl = document.querySelector("input[name='ios-rollout-type']:checked");
      const rolloutType = rolloutTypeEl ? rolloutTypeEl.value : "full";
      payload.ios = { rolloutType };
    }

    setStatusBadge("running");
    setButtonRunning(true);

    try {
      await startRelease(payload);
      startPolling(version);
    } catch (err) {
      showError(err.message || "Failed to start release");
      setStatusBadge("error");
      setButtonRunning(false);
    }
  });
}

/* ── Auto-init (module scripts are deferred, DOM is ready) ──────────────────── */
initPlayStoreManager();
