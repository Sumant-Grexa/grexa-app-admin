import { readFileSync } from "fs";

const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
const packageName = process.env.PACKAGE_NAME;
const aabPath = process.env.AAB_PATH;
const releasePassword = process.env.RELEASE_PASSWORD;

if (!keyPath) throw new Error("Missing env var: GOOGLE_SERVICE_ACCOUNT_KEY_PATH");
if (!packageName) throw new Error("Missing env var: PACKAGE_NAME");
if (!aabPath) throw new Error("Missing env var: AAB_PATH");
if (!releasePassword) throw new Error("Missing env var: RELEASE_PASSWORD");

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
} catch (err) {
  throw new Error(`Failed to read service account key file at "${keyPath}": ${err.message}`);
}

for (const field of ["client_email", "private_key", "private_key_id", "token_uri"]) {
  if (!serviceAccount[field]) {
    throw new Error(`Service account key file is missing required field: "${field}"`);
  }
}

export const playStoreConfig = Object.freeze({
  serviceAccount: Object.freeze({
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
    privateKeyId: serviceAccount.private_key_id,
    tokenUri: serviceAccount.token_uri,
  }),
  packageName,
  aabPath,
  releasePassword,
});
