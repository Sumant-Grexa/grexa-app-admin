import { readFileSync } from "fs";

function loadConfig() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const packageName = process.env.PACKAGE_NAME;
  const releasePassword = process.env.RELEASE_PASSWORD;

  if (!keyPath) throw new Error("Missing env var: GOOGLE_SERVICE_ACCOUNT_KEY_PATH");
  if (!packageName) throw new Error("Missing env var: PACKAGE_NAME");
  if (!releasePassword) throw new Error("Missing env var: RELEASE_PASSWORD");

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to read service account key at "${keyPath}": ${err.message}`);
  }

  for (const field of ["client_email", "private_key", "private_key_id", "token_uri"]) {
    if (!serviceAccount[field]) {
      throw new Error(`Service account key missing required field: "${field}"`);
    }
  }

  return Object.freeze({
    serviceAccount: Object.freeze({
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
      privateKeyId: serviceAccount.private_key_id,
      tokenUri: serviceAccount.token_uri,
    }),
    packageName,
    releasePassword,
  });
}

let _config = null;

export function getPlayStoreConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

export function getReleasePassword() {
  const p = process.env.RELEASE_PASSWORD;
  if (!p) throw new Error("Missing env var: RELEASE_PASSWORD");
  return p;
}
