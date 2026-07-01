function loadConfig() {
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;
  const googleChatWebhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL || null;

  if (!githubToken) throw new Error("Missing env var: GITHUB_TOKEN");
  if (!githubRepo) throw new Error("Missing env var: GITHUB_REPO");

  return Object.freeze({
    githubToken,
    githubRepo,
    googleChatWebhookUrl,
  });
}

let _config = null;

export function getReleaseConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}
