import { api } from "./api.js";

export async function checkAuth() {
  try {
    const me = await api("GET", "/api/me");
    return me.authenticated;
  } catch {
    return false;
  }
}

export async function login(password) {
  await api("POST", "/api/login", { password });
}

export async function logout() {
  await api("POST", "/api/logout");
}

export function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
}

export function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
}

export function initAuth(onAuthenticated) {
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("password-input").value;
    const errEl = document.getElementById("login-error");
    errEl.classList.add("hidden");
    try {
      await login(pw);
      onAuthenticated();
    } catch {
      errEl.classList.remove("hidden");
      document.getElementById("password-input").select();
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await logout();
    location.reload();
  });
}
