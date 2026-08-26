import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "testStagingCache.json");

function defaultCache() {
  return {
    selectedModule: null,
    moduleCache: {
      fetchedAt: 0,
      modules: [],
    },
  };
}

function normalizeModule(module) {
  if (!module || typeof module !== "object") return null;

  const projectId = String(module.projectId || "").trim();
  const moduleId = String(module.moduleId || "").trim();
  const projectName = String(module.projectName || "").trim();
  const moduleName = String(module.moduleName || "").trim();
  const projectIdentifier = String(module.projectIdentifier || "").trim();

  if (!projectId || !moduleId || !projectName || !moduleName) return null;

  return {
    projectId,
    moduleId,
    projectName,
    moduleName,
    projectIdentifier,
  };
}

function normalizeModules(modules) {
  if (!Array.isArray(modules)) return [];
  return modules.map(normalizeModule).filter(Boolean);
}

function normalizeCache(raw) {
  const base = defaultCache();
  if (!raw || typeof raw !== "object") return base;

  const selectedModule = normalizeModule(raw.selectedModule);
  const fetchedAt = Number.parseInt(String(raw.moduleCache?.fetchedAt ?? "0"), 10);
  const modules = normalizeModules(raw.moduleCache?.modules);

  return {
    selectedModule,
    moduleCache: {
      fetchedAt: Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : 0,
      modules,
    },
  };
}

export function getTestStagingCache() {
  try {
    if (!existsSync(CACHE_FILE)) {
      return defaultCache();
    }

    const rawText = readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(rawText);
    return normalizeCache(parsed);
  } catch {
    return defaultCache();
  }
}

function writeCache(cache) {
  const normalized = normalizeCache(cache);
  writeFileSync(CACHE_FILE, JSON.stringify(normalized, null, 2), "utf-8");
  return normalized;
}

export function setTestStagingModuleCache(modules) {
  const cache = getTestStagingCache();
  cache.moduleCache = {
    fetchedAt: Date.now(),
    modules: normalizeModules(modules),
  };
  return writeCache(cache);
}

export function setTestStagingSelectedModule(module) {
  const cache = getTestStagingCache();
  cache.selectedModule = normalizeModule(module);
  return writeCache(cache);
}
