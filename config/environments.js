import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, "environments.json");

/** @returns {Record<string, import('./environments.js').Env>} */
export function getEnvs() {
  return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
}

/** @param {import('./environments.js').Env} env */
export function addEnv(env) {
  const envs = getEnvs();
  envs[env.id] = env;
  writeFileSync(CONFIG_FILE, JSON.stringify(envs, null, 2), "utf-8");
}

/** @param {string} id */
export function removeEnv(id) {
  const envs = getEnvs();
  delete envs[id];
  writeFileSync(CONFIG_FILE, JSON.stringify(envs, null, 2), "utf-8");
}
