// ─────────────────────────────────────────────────────────────────────────────
// Resolves the AES-256-GCM key used to encrypt Fabric private keys at rest.
// A hard-coded fallback key is only allowed outside production, and loudly.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");

const HEX_KEY = /^[0-9a-fA-F]{64}$/;

function resolveEncryptionKey(env = process.env, warn = console.warn) {
  const configured = env.ENCRYPTION_KEY;

  if (configured) {
    if (!HEX_KEY.test(configured)) {
      throw new Error(
        "ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with: " +
          "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    return configured;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY must be set in production");
  }

  warn("[SECURITY] ENCRYPTION_KEY is not set: using an INSECURE development key. Never do this outside local development.");
  return crypto.createHash("sha256").update("default-dev-key").digest("hex");
}

module.exports = { resolveEncryptionKey };
