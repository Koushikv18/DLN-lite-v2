// ─────────────────────────────────────────────────────────────────────────────
// DLN-Lite Backend Server
// Entry point — sets up Express, middleware, routes
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const { connectDB } = require("./utils/db");
const logger = require("./utils/logger");

const shipmentRoutes = require("./routes/shipmentRoutes");
const mlRoutes = require("./routes/mlRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const healthRoutes = require("./routes/healthRoutes");
const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "null",
];

function normalizeOrigin(origin = "") {
  return String(origin || "").trim().replace(/\/+$/, "");
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const configuredOrigins = [
    FRONTEND_URL,
    process.env.CORS_ALLOWED_ORIGINS,
  ]
    .flatMap((value) => String(value || "").split(","))
    .map(normalizeOrigin)
    .filter(Boolean);

  const allowedOrigins = new Set([...DEFAULT_LOCAL_ORIGINS, ...configuredOrigins]);
  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  // Render preview/static URLs can change, so allow secure onrender.com origins in production.
  if (process.env.NODE_ENV === "production" && /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(normalizedOrigin)) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connect to MongoDB (off-chain bulk data)
// ─────────────────────────────────────────────────────────────────────────────
connectDB();

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: "10mb" }));
app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Rate limiting — prevent API abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 200 : 5000,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/", limiter);

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const acceptsHtml = req.accepts(["html", "json"]) === "html";

  if (FRONTEND_URL && acceptsHtml) {
    res.redirect(302, FRONTEND_URL);
    return;
  }

  res.status(200).json({
    service: "Cargo Intel API",
    status: "ok",
    frontend: FRONTEND_URL || null,
    docs: {
      health: "/api/health",
      shipments: "/api/shipments",
      analytics: "/api/analytics/summary",
    },
  });
});

app.use("/api/shipments", shipmentRoutes);  // Blockchain + DB shipment operations
app.use("/api/ml", mlRoutes);               // ML predictions
app.use("/api/analytics", analyticsRoutes); // Dashboard analytics
app.use("/api/health", healthRoutes);       // System health check
app.use("/api/auth", authRoutes);           // Account sign-up / sign-in
app.use("/api/chat", chatRoutes);           // Grok chatbot proxy

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`✅ DLN-Lite API running on http://localhost:${PORT}`);
  logger.info(`   Environment: ${process.env.NODE_ENV || "development"}`);
});

module.exports = app; // for tests
