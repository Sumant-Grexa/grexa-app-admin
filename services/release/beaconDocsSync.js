import fs from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const BULK_MAX_FILES = 10;
const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const R2_REGION = "auto";
const BUCKET_PREFIX = "support-agent-rag";
const BEACON_SIGN_IN_PATH = "/auth/sign_in";
const BEACON_CREATE_DOCUMENT_METHOD = "POST";

function normalizeSlash(value) {
  return String(value || "").replace(/\\\\/g, "/");
}

function resolveUrl(baseUrl, maybePath) {
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  return new URL(maybePath, baseUrl).toString();
}

function resolveOrigin(baseUrl) {
  return new URL(baseUrl).origin;
}

function chunkBy(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sanitizeVersionPathSegment(appVersion) {
  const cleaned = String(appVersion || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!cleaned) {
    throw new Error("Beacon docs sync requires a valid app version.");
  }

  return cleaned;
}

function normalizeRelativeMarkdownPath(relativePath) {
  const normalized = normalizeSlash(relativePath).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("Beacon docs sync found an empty markdown relative path.");
  }

  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    throw new Error("Beacon docs sync found an invalid markdown relative path.");
  }

  const last = parts[parts.length - 1];
  if (path.extname(last).toLowerCase() !== ".md") {
    throw new Error(`Beacon docs sync expected a markdown file but got: ${relativePath}`);
  }

  return parts.join("/");
}

function buildBucketKey(appVersion, relativePath) {
  const version = sanitizeVersionPathSegment(appVersion);
  const normalizedRelativePath = normalizeRelativeMarkdownPath(relativePath);
  return `${BUCKET_PREFIX}/${version}/${normalizedRelativePath}`;
}

function encodePathForUrl(key) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function buildPublicFileUrl(publicBaseUrl, bucketKey) {
  const normalizedBase = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (!normalizedBase) {
    throw new Error("Missing R2 public base URL for Beacon docs.");
  }
  return `${normalizedBase}/${encodePathForUrl(bucketKey)}`;
}

function createS3Client(config) {
  return new S3Client({
    region: R2_REGION,
    endpoint: config.r2Endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
      ...(config.r2SessionToken ? { sessionToken: config.r2SessionToken } : {}),
    },
  });
}

async function collectLocalMarkdownDocs(rootDir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        files.push({
          absolutePath,
          relativePath: normalizeSlash(path.relative(rootDir, absolutePath)),
          fileName: path.basename(entry.name),
        });
      }
    }
  }

  await walk(rootDir);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

async function uploadMarkdownToR2(s3Client, config, file, bucketKey) {
  const content = await fs.readFile(file.absolutePath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: bucketKey,
      Body: content,
      ContentType: MARKDOWN_CONTENT_TYPE,
    })
  );
}

function buildBeaconCreateDocumentUrl(baseUrl, accountId) {
  const origin = resolveOrigin(baseUrl);
  return resolveUrl(origin, `/api/v1/accounts/${encodeURIComponent(String(accountId))}/captain/documents`);
}

function maybeRotateAuthHeaders(authHeaders, response) {
  const accessToken = response.headers.get("access-token");
  const client = response.headers.get("client");
  const uid = response.headers.get("uid");
  if (accessToken) authHeaders.accessToken = accessToken;
  if (client) authHeaders.client = client;
  if (uid) authHeaders.uid = uid;
}

function assertBeaconConfig(config) {
  const missing = [];
  if (!config.baseUrl) missing.push("beacon.baseUrl");
  if (!config.accountId) missing.push("beacon.accountId");
  if (!config.assistantId) missing.push("beacon.assistantId");
  if (!config.adminEmail) missing.push("beacon.adminEmail");
  if (!config.adminPassword) missing.push("beacon.adminPassword");
  if (missing.length) {
    throw new Error(`Beacon docs sync is missing required config: ${missing.join(", ")}`);
  }
}

async function signInToBeacon(config) {
  const origin = resolveOrigin(config.baseUrl);
  const url = resolveUrl(origin, BEACON_SIGN_IN_PATH);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: config.adminEmail,
      password: config.adminPassword,
    }),
  });

  if (response.status === 206) {
    const mfa = await response.json().catch(() => null);
    const token = mfa?.mfa_token ? ` mfa_token=${mfa.mfa_token}` : "";
    throw new Error(`Beacon sign-in requires MFA (206). MFA flow is not automated yet.${token}`);
  }

  const jsonPayload = await response.json().catch(() => null);
  if (!response.ok) {
    const details = jsonPayload
      ? JSON.stringify(jsonPayload)
      : await response.text().catch(() => response.statusText);
    throw new Error(`Beacon API POST ${url} failed (${response.status}): ${details}`);
  }

  const authHeaders = {
    accessToken: response.headers.get("access-token"),
    client: response.headers.get("client"),
    uid: response.headers.get("uid"),
  };

  if (!authHeaders.accessToken || !authHeaders.client || !authHeaders.uid) {
    throw new Error("Beacon sign-in succeeded but auth headers are missing (access-token/client/uid).");
  }

  return authHeaders;
}

async function createBeaconDocument(config, authHeaders, entry) {
  const method = BEACON_CREATE_DOCUMENT_METHOD;
  const url = buildBeaconCreateDocumentUrl(config.baseUrl, config.accountId);
  const formData = new FormData();
  formData.append("document[assistant_id]", String(config.assistantId));
  formData.append("document[external_link]", entry.fileUrl);
  formData.append("document[name]", entry.fileName);

  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "access-token": authHeaders.accessToken,
      client: authHeaders.client,
      uid: authHeaders.uid,
    },
    body: formData,
  });

  const jsonPayload = await response.json().catch(() => null);
  if (!response.ok) {
    const details = jsonPayload
      ? JSON.stringify(jsonPayload)
      : await response.text().catch(() => response.statusText);
    throw new Error(`Beacon API ${method} ${url} failed (${response.status}): ${details}`);
  }

  maybeRotateAuthHeaders(authHeaders, response);
}

async function syncSingleDocument(config, authHeaders, s3Client, file, appVersion) {
  const bucketKey = buildBucketKey(appVersion, file.relativePath);
  const fileUrl = buildPublicFileUrl(config.r2PublicBaseUrl, bucketKey);

  await uploadMarkdownToR2(s3Client, config, file, bucketKey);

  const entry = {
    fileName: file.fileName,
    sourcePath: file.relativePath,
    appVersion: sanitizeVersionPathSegment(appVersion),
    bucketKey,
    fileUrl,
  };

  await createBeaconDocument(config, authHeaders, entry);
  return entry;
}

async function syncBatch(config, authHeaders, s3Client, files, appVersion, append) {
  const synced = await Promise.all(
    files.map((file) => syncSingleDocument(config, authHeaders, s3Client, file, appVersion))
  );
  append(`Beacon create batch complete: ${synced.length} file(s)`);
  return synced;
}

function assertNoBucketCollisions(files, appVersion) {
  const bucketKeyToSource = new Map();
  for (const file of files) {
    const key = buildBucketKey(appVersion, file.relativePath);
    const existingSource = bucketKeyToSource.get(key);
    if (existingSource) {
      throw new Error(
        `Beacon docs sync bucket key collision for "${key}". Sources: "${existingSource}" and "${file.relativePath}"`
      );
    }
    bucketKeyToSource.set(key, file.relativePath);
  }
}

export async function syncSupportAgentRagDocsToBeacon(config, appVersion, append) {
  if (!config?.enabled) {
    append("Beacon docs sync skipped: BEACON_API_BASE_URL is not configured.");
    return { created: 0, skipped: true, documents: [] };
  }

  assertBeaconConfig(config);

  const docsDir = config.localDocsDir;
  if (!docsDir) {
    throw new Error("Beacon docs sync is enabled but local docs directory is not configured");
  }

  const docsDirStats = await fs.stat(docsDir).catch(() => null);
  if (!docsDirStats?.isDirectory()) {
    throw new Error(`Beacon docs sync local directory does not exist: ${docsDir}`);
  }

  const localFiles = await collectLocalMarkdownDocs(docsDir);
  if (!localFiles.length) {
    append(`Beacon docs sync skipped: no markdown files found in ${docsDir}`);
    return { created: 0, skipped: true, documents: [] };
  }

  assertNoBucketCollisions(localFiles, appVersion);

  append(
    `Beacon docs sync: uploading ${localFiles.length} markdown file(s) to R2 path ${BUCKET_PREFIX}/${sanitizeVersionPathSegment(
      appVersion
    )}/<relative-path>.md`
  );

  append("Signing in to Beacon...");
  const authHeaders = await signInToBeacon(config);
  append("Beacon sign-in successful.");

  const s3Client = createS3Client(config);
  const syncedDocuments = [];

  for (const batch of chunkBy(localFiles, BULK_MAX_FILES)) {
    const result = await syncBatch(config, authHeaders, s3Client, batch, appVersion, append);
    syncedDocuments.push(...result);
  }

  return {
    created: syncedDocuments.length,
    skipped: false,
    documents: syncedDocuments,
  };
}
