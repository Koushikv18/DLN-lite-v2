const express = require("express");
const axios = require("axios");
const { body, validationResult } = require("express-validator");

const logger = require("../utils/logger");
const fabricService = require("../services/fabricService");
const ShipmentMeta = require("../models/ShipmentMeta");

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: errors.array()[0].msg, errors: errors.array() });
  }
  next();
};

const formatDate = (value) => {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
};

const summarizeShipment = (shipment, meta) => {
  if (!shipment) return "Shipment not found.";
  const notes = meta?.notes ? ` Notes: ${meta.notes}.` : "";
  const contact = meta?.contactEmail ? ` Contact: ${meta.contactEmail}.` : "";
  return [
    `${shipment.shipmentId} is currently ${shipment.status || "UNKNOWN"}.`,
    `Route: ${shipment.origin || "unknown"} to ${shipment.destination || "unknown"}.`,
    `Carrier: ${shipment.carrier || "unknown"}.`,
    `Cargo: ${shipment.cargoType || "unknown"} (${shipment.weightKg || "?"} kg).`,
    `ETA: ${formatDate(shipment.estimatedArrival)}.`,
    `Events recorded: ${shipment.events?.length || 0}.`,
  ].join(" ") + notes + contact;
};

const buildLocalReply = async ({ message, role, context }) => {
  const normalizedMessage = String(message || "").trim();
  const lowered = normalizedMessage.toLowerCase();
  const shipments = await fabricService.getAllShipments();
  const shipmentIds = shipments.map((shipment) => shipment.shipmentId);
  const metas = shipmentIds.length
    ? await ShipmentMeta.find({ shipmentId: { $in: shipmentIds } }).lean()
    : [];
  const metaMap = Object.fromEntries(metas.map((meta) => [meta.shipmentId, meta]));

  const matchedId =
    normalizedMessage.match(/\bSHP-[A-Z0-9]+\b/i)?.[0]?.toUpperCase() ||
    context?.shipments?.find((shipment) => lowered.includes(String(shipment.id || "").toLowerCase()))?.id ||
    null;

  if (matchedId) {
    const shipment = shipments.find((item) => item.shipmentId === matchedId);
    const meta = metaMap[matchedId];
    if (!shipment) {
      return {
        reply: `I could not find shipment ${matchedId} in the current records.`,
        source: "local-db",
      };
    }
    return {
      reply: summarizeShipment(shipment, meta),
      source: "local-db",
    };
  }

  const delayed = shipments.filter((shipment) => shipment.status === "DELAYED");
  const delivered = shipments.filter((shipment) => shipment.status === "DELIVERED");
  const active = shipments.filter((shipment) => !["DELIVERED"].includes(shipment.status));
  const highRisk = shipments
    .filter((shipment) => Number(shipment.delayRiskScore || 0) >= 0.6)
    .sort((a, b) => Number(b.delayRiskScore || 0) - Number(a.delayRiskScore || 0))
    .slice(0, 3);

  if (/(delay|delayed|late|risk|risky)/i.test(lowered)) {
    if (!delayed.length && !highRisk.length) {
      return {
        reply: "No delayed or high-risk shipments are flagged right now in the available shipment records.",
        source: "local-db",
      };
    }

    const delayedLine = delayed.length
      ? `Delayed shipments: ${delayed.map((shipment) => shipment.shipmentId).join(", ")}.`
      : "No shipment is marked delayed right now.";
    const riskLine = highRisk.length
      ? `Highest risk scores: ${highRisk
          .map((shipment) => `${shipment.shipmentId} (${Math.round(Number(shipment.delayRiskScore || 0) * 100)}%)`)
          .join(", ")}.`
      : "No shipment has a high delay-risk score right now.";

    return {
      reply: `${delayedLine} ${riskLine}`,
      source: "local-db",
    };
  }

  if (/(summary|overview|status|shipment|dashboard|count|how many)/i.test(lowered)) {
    const recent = [...shipments]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 3)
      .map((shipment) => `${shipment.shipmentId} (${shipment.status || "UNKNOWN"})`)
      .join(", ");

    return {
      reply: [
        `For ${role || "this"} operations view, I found ${shipments.length} total shipments.`,
        `${active.length} are active, ${delivered.length} are delivered, and ${delayed.length} are delayed.`,
        recent ? `Most recent records: ${recent}.` : "No recent shipment records were found.",
      ].join(" "),
      source: "local-db",
    };
  }

  const metaWithNotes = metas.filter((meta) => meta.notes).slice(0, 3);
  const notesLine = metaWithNotes.length
    ? `Mongo notes available for ${metaWithNotes.map((meta) => meta.shipmentId).join(", ")}.`
    : "There are no shipment notes stored in MongoDB right now.";

  return {
    reply: [
      "I’m answering from the local shipment records instead of external AI.",
      `There are ${shipments.length} shipments in the system.`,
      notesLine,
      "Ask me for a shipment ID like SHP-001 or ask for delays, risks, or a shipment summary.",
    ].join(" "),
    source: "local-db",
  };
};

router.post(
  "/grok",
  [
    body("message").trim().isLength({ min: 1 }).withMessage("Message is required"),
    body("history").optional().isArray().withMessage("History must be an array"),
    body("role").optional().isString(),
    body("context").optional().isObject(),
  ],
  validate,
  async (req, res) => {
    const apiKey = process.env.GROQ_API_KEY;
    const role = req.body.role || "guest";
    const context = req.body.context || {};

    try {
      if (!apiKey) {
        const local = await buildLocalReply({ message: req.body.message, role, context });
        return res.json({
          success: true,
          reply: local.reply,
          model: "local-mongo-copilot",
          source: local.source,
        });
      }

      const history = Array.isArray(req.body.history) ? req.body.history.slice(-10) : [];
      const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

      const shipmentLines = Array.isArray(context.shipments)
        ? context.shipments.slice(0, 8).map((shipment) =>
            `${shipment.id}: ${shipment.origin} -> ${shipment.dest}, ${shipment.status}, carrier ${shipment.carrier}, ETA ${shipment.eta}`
          ).join("\n")
        : "No shipment context provided.";

      const systemPrompt = [
        "You are Cargo Intel Copilot, an operations assistant inside a blockchain logistics portal.",
        "Give concise, practical answers.",
        `Current user role: ${role}.`,
        "Use the shipment context when relevant.",
        "If asked about shipment state, explain it in terms of shipper, carrier, and customs operations.",
        "If you are unsure, say what is missing instead of inventing details.",
        "Shipment context:",
        shipmentLines,
      ].join("\n");

      const messages = [
        { role: "system", content: systemPrompt },
        ...history
          .filter((item) => item && ["user", "assistant"].includes(item.role) && item.content)
          .map((item) => ({ role: item.role, content: String(item.content) })),
        { role: "user", content: req.body.message },
      ];

      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 60000,
        }
      );

      const data = response.data || {};
      const text =
        data.choices?.[0]?.message?.content ||
        "I could not generate a response.";

      res.json({
        success: true,
        reply: text,
        model: data.model || model,
        source: "groq",
      });
    } catch (error) {
      logger.error(`POST /chat/grok error: ${error.response?.data?.error?.message || error.response?.data?.error || error.message}`);
      const local = await buildLocalReply({ message: req.body.message, role, context });
      res.json({
        success: true,
        reply: `${local.reply} External AI is unavailable, so this answer came from the local shipment database.`,
        model: "local-mongo-copilot",
        source: local.source,
      });
    }
  }
);

module.exports = router;
