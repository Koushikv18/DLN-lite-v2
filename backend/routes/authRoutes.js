const crypto = require("crypto");
const express = require("express");
const { body, validationResult } = require("express-validator");

const AuthUser = require("../models/AuthUser");
const { registerAndEnrollUser } = require("../services/caService");

const router = express.Router();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: errors.array()[0].msg, errors: errors.array() });
  }
  next();
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => ({
  salt,
  hash: crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex"),
});

const makeSession = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
};

const sanitizeUser = (user) => ({
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});

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

router.post(
  "/register",
  [
    body("name").trim().isLength({ min: 2 }).withMessage("Full name must be at least 2 characters"),
    body("email").isEmail().withMessage("Enter a valid email address"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body("role").isIn(["shipper", "carrier", "customs"]).withMessage("Select a valid role"),
  ],
  validate,
  async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const existing = await AuthUser.findOne({ email }).lean();
      if (existing) {
        return res.status(409).json({ success: false, error: "An account with that email already exists" });
      }

      const { hash, salt } = hashPassword(req.body.password);
      const session = makeSession();
      const now = new Date().toISOString();

      await AuthUser.create({
        name: req.body.name.trim(),
        email,
        role: req.body.role,
        passwordHash: hash,
        passwordSalt: salt,
        sessionTokenHash: session.tokenHash,
        sessionExpiresAt: session.expiresAt,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Fabric CA Registration and Enrollment
      try {
        await registerAndEnrollUser(email, req.body.role);
      } catch (caError) {
        // If CA enrollment fails, we should ideally rollback the user creation, 
        // but for now we'll just throw the error so the frontend knows it failed.
        await AuthUser.updateOne({ email }, { $set: { sessionExpiresAt: null } }); // invalidate session
        throw new Error(`Fabric CA Enrollment failed: ${caError.message}`);
      }

      const created = await AuthUser.findOne({ email }).lean();
      res.status(201).json({
        success: true,
        message: "Account created successfully",
        token: session.token,
        user: sanitizeUser(created),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Enter a valid email address"),
    body("password").notEmpty().withMessage("Password is required"),
    body("role").optional().isIn(["shipper", "carrier", "customs"]).withMessage("Select a valid role"),
  ],
  validate,
  async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const user = await AuthUser.findOne({ email }).lean();
      if (!user) {
        return res.status(401).json({ success: false, error: "Invalid email or password" });
      }

      const { hash } = hashPassword(req.body.password, user.passwordSalt);
      if (hash !== user.passwordHash) {
        return res.status(401).json({ success: false, error: "Invalid email or password" });
      }

      if (req.body.role && req.body.role !== user.role) {
        return res.status(403).json({ success: false, error: `This account is registered for the ${user.role} dashboard` });
      }

      const session = makeSession();
      const lastLoginAt = new Date().toISOString();
      await AuthUser.updateOne(
        { email },
        {
          $set: {
            sessionTokenHash: session.tokenHash,
            sessionExpiresAt: session.expiresAt,
            lastLoginAt,
          },
        }
      );

      const signedIn = await AuthUser.findOne({ email }).lean();
      res.json({
        success: true,
        message: "Login successful",
        token: session.token,
        user: sanitizeUser(signedIn),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.get("/me", async (req, res) => {
  try {
    const user = await findUserByToken(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Session expired or invalid" });
    }
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const user = await findUserByToken(req);
    if (user) {
      await AuthUser.updateOne(
        { email: user.email },
        {
          $set: {
            sessionTokenHash: null,
            sessionExpiresAt: null,
          },
        }
      );
    }
    res.json({ success: true, message: "Logged out" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
