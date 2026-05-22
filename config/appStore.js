function loadConfig() {
  const keyId          = process.env.ASC_KEY_ID;
  const issuerId       = process.env.ASC_ISSUER_ID;
  const privateKeyPath = process.env.ASC_PRIVATE_KEY_PATH;
  const appId          = process.env.ASC_APP_ID;

  if (!keyId)          throw new Error("Missing env var: ASC_KEY_ID");
  if (!issuerId)       throw new Error("Missing env var: ASC_ISSUER_ID");
  if (!privateKeyPath) throw new Error("Missing env var: ASC_PRIVATE_KEY_PATH");
  if (!appId)          throw new Error("Missing env var: ASC_APP_ID");

  return Object.freeze({ keyId, issuerId, privateKeyPath, appId });
}

let _config = null;

export function getAppStoreConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}
