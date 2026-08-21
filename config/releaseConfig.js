const SUPPORT_AGENT_RAG_RELATIVE_PATH = "docs/support-agent-rag";
export const BEACON_API_CALL_ENABLED_IN_CODE = false;

function parseAccountIdFromBaseUrl(urlValue) {
  if (!urlValue) return null;
  try {
    const parsed = new URL(urlValue);
    const match = parsed.pathname.match(/\/api\/v1\/accounts\/([^/]+)/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function loadConfig() {
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;
  const googleChatWebhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL || null;
  const googleChatBeaconDocsWebhookUrl =
    process.env.GOOGLE_CHAT_BEACON_DOCS_WEBHOOK_URL || null;
  const flutterAppRepoPath = process.env.FLUTTER_APP_REPO_PATH || null;

  if (!githubToken) throw new Error("Missing env var: GITHUB_TOKEN");
  if (!githubRepo) throw new Error("Missing env var: GITHUB_REPO");

  const beaconApiBaseUrl = process.env.BEACON_API_BASE_URL?.trim() || null;
  const defaultSupportAgentRagDir = flutterAppRepoPath
    ? `${flutterAppRepoPath.replace(/\/+$/, "")}/${SUPPORT_AGENT_RAG_RELATIVE_PATH}`
    : null;

  const beaconSyncEnabled = Boolean(beaconApiBaseUrl);
  const beaconAccountId = process.env.BEACON_ACCOUNT_ID || parseAccountIdFromBaseUrl(beaconApiBaseUrl);
  const beaconAssistantId = process.env.BEACON_ASSISTANT_ID || null;
  const beaconAdminEmail = process.env.BEACON_ADMIN_EMAIL || null;
  const beaconAdminPassword = process.env.BEACON_ADMIN_PASSWORD || null;
  const r2BucketName = process.env.R2_BUCKET_NAME || null;
  const r2Endpoint = process.env.R2_S3_ENDPOINT || null;
  const r2AccessKeyId = process.env.R2_S3_ACCESS_KEY_ID || null;
  const r2SecretAccessKey = process.env.R2_S3_SECRET_ACCESS_KEY || null;
  const r2SessionToken = process.env.R2_S3_SESSION_TOKEN || null;
  const r2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL || null;

  if (beaconSyncEnabled) {
    const missing = [];
    if (!flutterAppRepoPath) missing.push("FLUTTER_APP_REPO_PATH");
    if (!r2BucketName) missing.push("R2_BUCKET_NAME");
    if (!r2Endpoint) missing.push("R2_S3_ENDPOINT");
    if (!r2AccessKeyId) missing.push("R2_S3_ACCESS_KEY_ID");
    if (!r2SecretAccessKey) missing.push("R2_S3_SECRET_ACCESS_KEY");
    if (!r2PublicBaseUrl) missing.push("R2_PUBLIC_BASE_URL");

    if (BEACON_API_CALL_ENABLED_IN_CODE) {
      if (!beaconApiBaseUrl) missing.push("BEACON_API_BASE_URL");
      if (!beaconAccountId) {
        missing.push("BEACON_ACCOUNT_ID (or include /api/v1/accounts/:id in BEACON_API_BASE_URL)");
      }
      if (!beaconAssistantId) missing.push("BEACON_ASSISTANT_ID");
      if (!beaconAdminEmail) missing.push("BEACON_ADMIN_EMAIL");
      if (!beaconAdminPassword) missing.push("BEACON_ADMIN_PASSWORD");
    }

    if (missing.length) {
      throw new Error(
        `Beacon docs sync is enabled but R2/S3 config is incomplete. Missing: ${missing.join(", ")}`
      );
    }
  }

  return Object.freeze({
    githubToken,
    githubRepo,
    googleChatWebhookUrl,
    googleChatBeaconDocsWebhookUrl,
    flutterAppRepoPath,
    beacon: {
      enabled: beaconSyncEnabled,
      apiCallEnabled: BEACON_API_CALL_ENABLED_IN_CODE,
      baseUrl: beaconApiBaseUrl,
      accountId: beaconAccountId,
      assistantId: beaconAssistantId,
      adminEmail: beaconAdminEmail,
      adminPassword: beaconAdminPassword,
      r2BucketName,
      r2Endpoint,
      r2AccessKeyId,
      r2SecretAccessKey,
      r2SessionToken,
      r2PublicBaseUrl,
      localDocsDir: defaultSupportAgentRagDir,
    },
  });
}

let _config = null;

export function getReleaseConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}
