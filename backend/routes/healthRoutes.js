// ─────────────────────────────────────────────────────────────────────────────
// Health Routes
// System health check — checks DB, blockchain, and ML service
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const mlService = require("../services/mlService");
const { getDatabaseMode } = require("../utils/db");

router.get("/", async (req, res) => {
  const dbMode = getDatabaseMode();
  const dbStatus = dbMode === "mongodb" ? "ok" : dbMode === "memory" ? "fallback" : "down";
  const mlStatus = await mlService.healthCheck();

  const apiStatus = "ok";
  const overallStatus = dbStatus === "ok" && mlStatus.status === "ok" ? "healthy" : "degraded";

  res.status(200).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      api: apiStatus,
      mongodb: dbStatus,
      mlService: mlStatus.status,
      blockchain: "check fabric logs", // Fabric has its own health endpoint
    },
    storageMode: dbMode,
  });
});

module.exports = router;
