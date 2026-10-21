// ─────────────────────────────────────────────────────────────────────────────
// Shipment Routes
// All REST endpoints for shipment operations.
// Each route talks to the blockchain (via fabricService) and MongoDB.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const { body, param, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const fabricService = require("../services/fabricService");
const mlService = require("../services/mlService");
const ShipmentMeta = require("../models/ShipmentMeta");
const logger = require("../utils/logger");
const { authenticate, requireRole } = require("../middleware/auth");
const { verifyChain } = require("../utils/auditChain");

// Middleware to handle validation errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Every shipment endpoint needs a signed-in user: blockchain calls are made
// with that user's own Fabric identity (req.user.email is the wallet label).
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shipments
// Returns all shipments (from blockchain) with ML risk scores
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const shipments = await fabricService.getAllShipments(req.user.email);

    // Attach MongoDB metadata (notes, documents, etc.) to each shipment
    const metas = await ShipmentMeta.find({
      shipmentId: { $in: shipments.map((s) => s.shipmentId) },
    }).lean();

    const metaMap = {};
    metas.forEach((m) => (metaMap[m.shipmentId] = m));

    const enriched = shipments.map((s) => ({
      ...s,
      meta: metaMap[s.shipmentId] || {},
    }));

    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (error) {
    logger.error(`GET /shipments error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shipments/:id
// Returns a single shipment with full event history
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", param("id").notEmpty(), validate, async (req, res) => {
  try {
    const shipment = await fabricService.getShipment(req.user.email, req.params.id);
    const meta = await ShipmentMeta.findOne({ shipmentId: req.params.id }).lean();

    res.json({ success: true, data: { ...shipment, meta: meta || {} } });
  } catch (error) {
    const status = error.message.includes("does not exist") ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shipments
// Creates a new shipment on the blockchain
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/",
  requireRole("shipper"),
  [
    body("containerId").notEmpty().withMessage("Container ID is required"),
    body("origin").notEmpty().withMessage("Origin is required"),
    body("destination").notEmpty().withMessage("Destination is required"),
    body("carrier").notEmpty().withMessage("Carrier is required"),
    body("cargoType").notEmpty().withMessage("Cargo type is required"),
    body("weightKg").isFloat({ min: 1 }).withMessage("Weight must be a positive number"),
    body("estimatedArrival").isISO8601().withMessage("Estimated arrival must be a valid date"),
  ],
  validate,
  async (req, res) => {
    try {
      const shipmentId = `SHP-${uuidv4().slice(0, 8).toUpperCase()}`;
      const shipmentData = { shipmentId, ...req.body };

      // Write critical record to blockchain
      const blockchainRecord = await fabricService.createShipment(req.user.email, shipmentData);

      // Write metadata to MongoDB (bulk / non-critical data)
      const meta = await ShipmentMeta.create({
        shipmentId,
        notes: req.body.notes || "",
        documents: req.body.documents || [],
        contactEmail: req.body.contactEmail || "",
        createdBy: req.user.email,
      });

      // Kick off initial ML prediction asynchronously
      const actingUser = req.user.email;
      mlService
        .predictDelay(blockchainRecord)
        .then((prediction) => fabricService.updateDelayRisk(actingUser, shipmentId, prediction.delay_probability))
        .catch((err) => logger.warn(`Initial risk scoring failed for ${shipmentId}: ${err.message}`));

      res.status(201).json({
        success: true,
        message: "Shipment created on blockchain",
        data: { ...blockchainRecord, meta },
      });
    } catch (error) {
      logger.error(`POST /shipments error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shipments/:id/events
// Record a new milestone event on an existing shipment
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:id/events",
  [
    param("id").notEmpty(),
    body("eventType").notEmpty().withMessage("Event type is required"),
    body("location").notEmpty().withMessage("Location is required"),
    body("description").notEmpty().withMessage("Description is required"),
  ],
  validate,
  async (req, res) => {
    try {
      const { eventType, location, description } = req.body;
      const updated = await fabricService.recordEvent(req.user.email, req.params.id, eventType, location, description);

      res.json({
        success: true,
        message: `Event ${eventType} recorded on blockchain`,
        data: updated,
      });
    } catch (error) {
      logger.error(`POST /shipments/${req.params.id}/events error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shipments/:id/transfer
// Transfer custody from one org to another
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:id/transfer",
  requireRole("carrier"),
  [
    param("id").notEmpty(),
    body("newHolder").notEmpty().withMessage("New holder org is required"),
    body("location").notEmpty().withMessage("Location is required"),
  ],
  validate,
  async (req, res) => {
    try {
      const { newHolder, location } = req.body;
      const updated = await fabricService.transferCustody(req.user.email, req.params.id, newHolder, location);

      res.json({
        success: true,
        message: `Custody transferred to ${newHolder}`,
        data: updated,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shipments/:id/deliver
// Mark a shipment as delivered
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/deliver", requireRole("carrier", "customs"), param("id").notEmpty(), validate, async (req, res) => {
  try {
    const updated = await fabricService.markDelivered(req.user.email, req.params.id);
    res.json({ success: true, message: "Shipment marked as delivered", data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shipments/:id/history
// Returns immutable blockchain transaction history (full audit trail)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id/history", param("id").notEmpty(), validate, async (req, res) => {
  try {
    const history = await fabricService.getShipmentHistory(req.user.email, req.params.id);
    res.json({ success: true, count: history.length, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shipments/:id/audit
// Custody-trail audit. The chain is verified TWICE, independently:
//   1. by the chaincode, from the ledger's own copy of the record
//   2. by this server, re-computing every SHA-256 from the returned events
// "agree" is true only if both reach the same verdict and the same head hash.
// The head hash is a short fingerprint of the whole custody trail.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id/audit", param("id").notEmpty(), validate, async (req, res) => {
  try {
    const shipment = await fabricService.getShipment(req.user.email, req.params.id);
    const independent = verifyChain(shipment.events || []);

    let ledger;
    try {
      ledger = await fabricService.verifyEventChain(req.user.email, req.params.id);
    } catch (error) {
      ledger = { error: error.message };
    }

    const agree = ledger.error
      ? null
      : ledger.intact === independent.intact && ledger.headHash === independent.headHash;

    res.json({
      success: true,
      data: { shipmentId: req.params.id, headHash: independent.headHash, independent, ledger, agree },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/shipments/:id/status
// Directly update shipment status — requires MAJORITY endorsement on real Fabric
// ─────────────────────────────────────────────────────────────────────────────
router.put(
  "/:id/status",
  requireRole("carrier", "customs"),
  [
    param("id").notEmpty(),
    body("status").isIn(["CREATED","IN_TRANSIT","AT_PORT","IN_CUSTOMS","DELIVERED","DELAYED"])
      .withMessage("Invalid status value"),
    body("reason").notEmpty().withMessage("Reason is required"),
  ],
  validate,
  async (req, res) => {
    try {
      const { status, reason } = req.body;
      const updated = await fabricService.updateStatus(req.user.email, req.params.id, status, reason);
      res.json({ success: true, message: `Status updated to ${status}`, data: updated });
    } catch (error) {
      logger.error(`PUT /shipments/${req.params.id}/status error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shipments/:id/verify
// Immutability demo — checks if supplied data matches the on-chain record
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:id/verify",
  [param("id").notEmpty(), body("claimedData").notEmpty()],
  validate,
  async (req, res) => {
    try {
      const result = await fabricService.verifyIntegrity(req.user.email, req.params.id, JSON.stringify(req.body.claimedData));
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);
