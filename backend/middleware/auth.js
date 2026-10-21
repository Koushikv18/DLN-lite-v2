// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware
//   authenticate  — resolves the Bearer token to a user (401 if missing/expired)
//   requireRole   — limits a route to specific roles (403 otherwise)
//
// req.user.email is also the label of the user's Fabric identity in the wallet,
// so every blockchain call is signed as the person who made the request.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");
const AuthUser = require("../models/AuthUser");

async function findUserByToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await AuthUser.findOne({ sessionTokenHash: tokenHash }).lean();
  if (!user?.sessionExpiresAt) return null;
  if (new Date(user.sessionExpiresAt).getTime() < Date.now()) return null;
  return user;
}

async function authenticate(req, res, next) {
  try {
    const user = await findUserByToken(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required: sign in again" });
    }
    req.user = { email: user.email, role: user.role, name: user.name };
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: `Access denied: this action requires one of these roles: ${roles.join(", ")}`,
    });
  }
  next();
};

module.exports = { authenticate, requireRole, findUserByToken };
