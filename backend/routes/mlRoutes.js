// ─────────────────────────────────────────────────────────────────────────────
// ML Routes
// Endpoints for accessing ML predictions via the backend.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const { body, param, validationResult } = require("express-validator");
const router = express.Router();

const fabricService = require("../services/fabricService");
const mlService = require("../services/mlService");
const logger = require("../utils/logger");

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ml/predict/:shipmentId
// Get ML delay prediction for a specific shipment
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/predict/:shipmentId",
  [param("shipmentId").notEmpty()],
  validate,
  async (req, res) => {
    try {
      // Fetch shipment data from blockchain
      const shipment = await fabricService.getShipment(req.params.shipmentId);

      // Caller can pass extra enrichment data (port congestion, weather)
      const enrichment = req.body || {};

      // Get prediction from ML service
      const prediction = await mlService.predictDelay(shipment, enrichment);

      // Store updated risk score back on blockchain
      await fabricService.updateDelayRisk(req.params.shipmentId, prediction.delay_probability);

      res.json({
        success: true,
        shipmentId: req.params.shipmentId,
        prediction,
      });
    } catch (error) {
      logger.error(`ML predict error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ml/predict-manual
// Get ML prediction for a custom feature set (for testing / dashboard demo)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/predict-manual",
  [
    body("origin_port").notEmpty(),
    body("destination_port").notEmpty(),
    body("carrier").notEmpty(),
  ],
  validate,
  async (req, res) => {
    try {
      const mockShipment = {
        shipmentId: "MANUAL-TEST",
        origin: req.body.origin_port,
        destination: req.body.destination_port,
        carrier: req.body.carrier,
        cargoType: req.body.cargo_type || "General",
        weightKg: req.body.weight_kg || 5000,
      };

      const prediction = await mlService.predictDelay(mockShipment, req.body);
      res.json({ success: true, prediction });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ml/batch-update
// Updates risk scores for ALL active shipments (cron job target)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/batch-update", async (req, res) => {
  try {
    const shipments = await fabricService.getAllShipments();
    const activeShipments = shipments.filter(
      (s) => s.status !== "DELIVERED" && s.status !== "CREATED"
    );

    const results = [];
    for (const shipment of activeShipments) {
      const prediction = await mlService.predictDelay(shipment);
      await fabricService.updateDelayRisk(shipment.shipmentId, prediction.delay_probability);
      results.push({
        shipmentId: shipment.shipmentId,
        riskScore: prediction.delay_probability,
        riskLevel: prediction.risk_level,
      });
    }

    logger.info(`Batch risk update complete: ${results.length} shipments updated`);
    res.json({ success: true, updated: results.length, results });
  } catch (error) {
    logger.error(`Batch update error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
