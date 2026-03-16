/**
 * Middleware to protect routes that require an authenticated session.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: "Unauthorized" });
}

export default requireAuth;
