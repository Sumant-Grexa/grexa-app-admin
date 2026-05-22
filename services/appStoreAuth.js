import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { getAppStoreConfig } from "../config/appStore.js";

export function generateAppStoreToken() {
  const { keyId, issuerId, privateKeyPath } = getAppStoreConfig();
  const privateKey = readFileSync(privateKeyPath, "utf8");
  return jwt.sign(
    { iss: issuerId, aud: "appstoreconnect-v1" },
    privateKey,
    { algorithm: "ES256", keyid: keyId, expiresIn: "20m" }
  );
}
