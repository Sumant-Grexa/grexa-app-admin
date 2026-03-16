const PASSWORD = process.env.DEPLOY_PASSWORD || "grexa@preprod";

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
function login(req, res) {
  const { password } = req.body;
  if (password === PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Wrong password" });
  }
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
function logout(req, res) {
  req.session.destroy();
  res.json({ ok: true });
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
function me(req, res) {
  res.json({ authenticated: !!req.session?.authenticated });
}

export { login, logout, me };
