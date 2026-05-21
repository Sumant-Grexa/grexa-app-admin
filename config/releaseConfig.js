function loadConfig() {
  const repoPath = process.env.FLUTTER_APP_REPO_PATH;
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;

  if (!repoPath) throw new Error("Missing env var: FLUTTER_APP_REPO_PATH");
  if (!githubToken) throw new Error("Missing env var: GITHUB_TOKEN");
  if (!githubRepo) throw new Error("Missing env var: GITHUB_REPO");

  return Object.freeze({ repoPath, githubToken, githubRepo });
}

let _config = null;

export function getReleaseConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}
