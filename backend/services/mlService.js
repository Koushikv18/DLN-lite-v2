// ─────────────────────────────────────────────────────────────────────────────
// ML Service
// Communicates with the Python Flask ML prediction service.
// Formats features, sends request, returns structured prediction.
// ─────────────────────────────────────────────────────────────────────────────

const axios = require("axios");
const logger = require("../utils/logger");

const ML_URL = process.env.ML_SERVICE_URL || "http://localhost:5000";

const WEATHER_SCORES = {
  clear: 0.1,
  moderate: 0.45,
  storm: 0.9,
};

function pickValue(source, keys, fallback) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return fallback;
}

function normalizeEnrichment(enrichment = {}) {
  return {
    numStops: Number(pickValue(enrichment, ["numStops", "num_stops"], 1)),
    distanceKm: Number(pickValue(enrichment, ["distanceKm", "distance_km"], 8000)),
    originCongestion: Number(pickValue(enrichment, ["originCongestion", "origin_congestion"], 0.5)),
    destinationCongestion: Number(pickValue(enrichment, ["destinationCongestion", "destination_congestion"], 0.5)),
    weatherSeverity: pickValue(enrichment, ["weatherSeverity", "weather_severity"], "clear"),
    carrierDelayRate: Number(pickValue(enrichment, ["carrierDelayRate", "carrier_delay_rate"], 0.2)),
    routeAvgDelayDays: Number(pickValue(enrichment, ["routeAvgDelayDays", "route_avg_delay_days"], 2.0)),
    month: Number(pickValue(enrichment, ["month"], new Date().getMonth() + 1)),
    cargoType: pickValue(enrichment, ["cargoType", "cargo_type"], null),
    weightKg: Number(pickValue(enrichment, ["weightKg", "weight_kg"], NaN)),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildHeuristicPrediction(shipment, enrichment = {}) {
  const normalized = normalizeEnrichment(enrichment);
  const weather = String(normalized.weatherSeverity || "clear").toLowerCase();
  const weightKg = Number.isFinite(normalized.weightKg) ? normalized.weightKg : Number(shipment.weightKg || 5000);

  const contributions = [
    { factor: "Route distance", value: clamp(normalized.distanceKm / 25000, 0, 1), weight: 0.2 },
    { factor: "Number of transit stops", value: clamp(normalized.numStops / 4, 0, 1), weight: 0.14 },
    { factor: "Cargo weight", value: clamp(weightKg / 30000, 0, 1), weight: 0.08 },
    { factor: "Origin port congestion", value: clamp(normalized.originCongestion, 0, 1), weight: 0.18 },
    { factor: "Destination port congestion", value: clamp(normalized.destinationCongestion, 0, 1), weight: 0.12 },
    { factor: "Weather conditions", value: WEATHER_SCORES[weather] ?? 0.2, weight: 0.16 },
    { factor: "Carrier historical delay rate", value: clamp(normalized.carrierDelayRate, 0, 1), weight: 0.08 },
    { factor: "Route average delay history", value: clamp(normalized.routeAvgDelayDays / 14, 0, 1), weight: 0.04 },
  ];

  const probability = clamp(
    contributions.reduce((sum, item) => sum + item.value * item.weight, 0),
    0.03,
    0.97
  );

  const top_factors = contributions
    .map((item) => ({
      factor: item.factor,
      contribution: item.value * item.weight,
    }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((item) => ({
      factor: item.factor,
      importance: Number((item.contribution / probability).toFixed(4)),
    }));

  return {
    delay_probability: Number(probability.toFixed(4)),
    risk_level: probability < 0.4 ? "LOW" : probability < 0.7 ? "MEDIUM" : "HIGH",
    top_factors,
    predicted_delay_days: probability >= 0.4 ? Number((probability * normalized.routeAvgDelayDays * 1.8).toFixed(1)) : 0,
    fallback: true,
  };
}

const mlService = {
  /**
   * Get delay prediction for a shipment.
   * Sends relevant features to the Python ML service.
   *
   * @param {Object} shipment - Shipment data from blockchain
   * @param {Object} enrichment - Additional data (port congestion, weather)
   * @returns {Object} prediction result with risk score and factors
   */
  async predictDelay(shipment, enrichment = {}) {
    try {
      const normalized = normalizeEnrichment(enrichment);

      // Build the feature vector the ML model expects
      const features = {
        origin_port:            shipment.origin,
        destination_port:       shipment.destination,
        carrier:                shipment.carrier,
        cargo_type:             normalized.cargoType || shipment.cargoType,
        weight_kg:              Number.isFinite(normalized.weightKg) ? normalized.weightKg : shipment.weightKg,
        num_stops:              normalized.numStops,
        distance_km:            normalized.distanceKm,
        origin_congestion:      normalized.originCongestion,
        destination_congestion: normalized.destinationCongestion,
        weather_severity:       normalized.weatherSeverity,
        month:                  normalized.month,
        carrier_delay_rate:     normalized.carrierDelayRate,
        route_avg_delay_days:   normalized.routeAvgDelayDays,
      };

      const response = await axios.post(`${ML_URL}/predict`, features, {
        timeout: 5000,
        headers: { "Content-Type": "application/json" },
      });

      logger.info(`ML prediction for ${shipment.shipmentId}: ${response.data.delay_probability}`);
      return response.data;
    } catch (error) {
      logger.warn(`ML service unavailable: ${error.message}. Returning heuristic fallback.`);
      return buildHeuristicPrediction(shipment, enrichment);
    }
  },

  /**
   * Batch predict delays for multiple shipments (used for dashboard overview)
   */
  async batchPredict(shipmentsWithEnrichment) {
    try {
      const response = await axios.post(
        `${ML_URL}/batch-predict`,
        { shipments: shipmentsWithEnrichment },
        { timeout: 15000 }
      );
      return response.data.predictions;
    } catch (error) {
      logger.warn(`Batch ML prediction failed: ${error.message}`);
      return shipmentsWithEnrichment.map((s) => buildHeuristicPrediction(s, s));
    }
  },

  /**
   * Check if the ML service is healthy
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${ML_URL}/health`, { timeout: 3000 });
      return { status: "ok", details: response.data };
    } catch (error) {
      return { status: "down", error: error.message };
    }
  },
};

module.exports = mlService;
