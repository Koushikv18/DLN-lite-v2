const express = require("express");
const router = express.Router();
const fabricService = require("../services/fabricService");
const logger = require("../utils/logger");

router.get("/summary", async (req, res) => {
  try {
    const shipments = await fabricService.getAllShipments() || [];
    const total = shipments.length;
    const inTransit = shipments.filter(s => s.status === "IN_TRANSIT").length;
    const delivered = shipments.filter(s => s.status === "DELIVERED").length;
    const delayed = shipments.filter(s => s.status === "DELAYED").length;
    const highRisk = shipments.filter(s => (s.delayRiskScore || 0) >= 0.7).length;
    const avgRisk = total > 0 ? shipments.reduce((sum, s) => sum + (s.delayRiskScore || 0), 0) / total : 0;
    res.json({
      success: true, data: {
        total, inTransit, delivered, delayed, highRisk,
        avgRiskScore: parseFloat(avgRisk.toFixed(3)),
        onTimeRate: total > 0 ? parseFloat(((total - delayed) / total).toFixed(3)) : 1
      }
    });
  } catch (e) {
    logger.error(`Analytics summary error: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get("/risk-distribution", async (req, res) => {
  try {
    const shipments = await fabricService.getAllShipments() || [];
    const active = shipments.filter(s => s.status !== "DELIVERED");
    res.json({
      success: true, data: {
        low: active.filter(s => (s.delayRiskScore || 0) < 0.4).length,
        medium: active.filter(s => (s.delayRiskScore || 0) >= 0.4 && (s.delayRiskScore || 0) < 0.7).length,
        high: active.filter(s => (s.delayRiskScore || 0) >= 0.7).length,
      }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/top-routes", async (req, res) => {
  try {
    const shipments = await fabricService.getAllShipments() || [];
    const counts = {};
    shipments.forEach(s => { const k = `${s.origin} → ${s.destination}`; counts[k] = (counts[k] || 0) + 1; });
    const topRoutes = Object.entries(counts).map(([route, count]) => ({ route, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    res.json({ success: true, data: topRoutes });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;