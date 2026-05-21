import crypto from "crypto";

/**
 * @param {object | Buffer} input
 * @returns {string}
 */
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input));
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {{ clientEmail: string, privateKey: string, privateKeyId: string, tokenUri: string }} sa
 * @returns {string}
 */
function buildJWT(sa) {
  const now = Math.floor(Date.now() / 1000);

  const header = base64url({ alg: "RS256", typ: "JWT", kid: sa.privateKeyId });
  const payload = base64url({
    iss: sa.clientEmail,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: sa.tokenUri,
    iat: now,
    exp: now + 3600,
  });

  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign("SHA256");
  signer.update(signingInput);
  const sig = base64url(signer.sign(sa.privateKey));

  return `${signingInput}.${sig}`;
}

/**
 * Exchanges a signed JWT for a Google OAuth2 access token.
 * @param {{ clientEmail: string, privateKey: string, privateKeyId: string, tokenUri: string }} serviceAccount
 * @returns {Promise<string>} Bearer access token, valid for 3600s
 */
export async function getAccessToken(serviceAccount) {
  const jwt = buildJWT(serviceAccount);

  const res = await fetch(serviceAccount.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.access_token;
}
