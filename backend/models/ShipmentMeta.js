// ─────────────────────────────────────────────────────────────────────────────
// ShipmentMeta — MongoDB Model
// Stores off-chain bulk metadata about shipments.
// Critical data (status, events, ownership) lives on blockchain.
// Non-critical data (notes, docs, contacts) lives here.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  type:       { type: String, enum: ["BILL_OF_LADING", "CUSTOMS_FORM", "INSURANCE", "INVOICE", "OTHER"] },
  url:        { type: String },
  uploadedAt: { type: Date, default: Date.now },
});

const shipmentMetaSchema = new mongoose.Schema(
  {
    shipmentId:   { type: String, required: true, unique: true, index: true },
    notes:        { type: String, default: "" },
    documents:    [documentSchema],
    contactEmail: { type: String, default: "" },
    createdBy:    { type: String, default: "unknown" },     // org that created it
    tags:         [{ type: String }],
    // Sensor data snapshots — high frequency data stays off-chain
    latestTemp:   { type: Number },
    latestHumidity: { type: Number },
    lastSensorAt: { type: Date },
  },
  {
    timestamps: true,
    collection: "shipment_meta",
  }
);

const ShipmentMetaModel = mongoose.model("ShipmentMeta", shipmentMetaSchema);

const memoryStore = new Map();

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeDoc = (doc) => ({
  shipmentId: doc.shipmentId,
  notes: doc.notes || "",
  documents: doc.documents || [],
  contactEmail: doc.contactEmail || "",
  createdBy: doc.createdBy || "unknown",
  tags: doc.tags || [],
  latestTemp: doc.latestTemp,
  latestHumidity: doc.latestHumidity,
  lastSensorAt: doc.lastSensorAt,
});

const useMemoryStore = () => global.__DLN_MEMORY_DB__ || mongoose.connection.readyState !== 1;

module.exports = {
  find(query = {}) {
    if (!useMemoryStore()) {
      return ShipmentMetaModel.find(query);
    }

    const shipmentIds = query.shipmentId?.$in;
    const docs = Array.from(memoryStore.values()).filter((doc) => {
      if (Array.isArray(shipmentIds)) {
        return shipmentIds.includes(doc.shipmentId);
      }
      return true;
    });

    return {
      lean: async () => clone(docs),
    };
  },

  findOne(query = {}) {
    if (!useMemoryStore()) {
      return ShipmentMetaModel.findOne(query);
    }

    const doc = memoryStore.get(query.shipmentId) || null;
    return {
      lean: async () => clone(doc),
    };
  },

  async create(doc) {
    if (!useMemoryStore()) {
      return ShipmentMetaModel.create(doc);
    }

    const normalized = normalizeDoc(doc);
    memoryStore.set(normalized.shipmentId, normalized);
    return clone(normalized);
  },
};
