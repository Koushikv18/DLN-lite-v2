// ─────────────────────────────────────────────────────────────────────────────
// tests/backend/shipment.test.js
// Integration tests for the shipment REST API.
// Uses supertest to hit the Express routes directly.
// Mock the fabricService so tests don't need a real blockchain.
// ─────────────────────────────────────────────────────────────────────────────

const request = require("supertest");
const app     = require("../../backend/server");

// ── Mock the blockchain service ────────────────────────────────────────────
jest.mock("../../backend/services/fabricService", () => ({
  createShipment: jest.fn().mockResolvedValue({
    shipmentId:       "SHP-TEST01",
    containerId:      "CONT-TEST",
    origin:           "Shanghai, CN",
    destination:      "Rotterdam, NL",
    carrier:          "TestCarrier",
    cargoType:        "Electronics",
    weightKg:         5000,
    status:           "CREATED",
    events:           [],
    delayRiskScore:   0.0,
    estimatedArrival: "2024-06-01T00:00:00Z",
    createdAt:        new Date().toISOString(),
  }),
  getAllShipments: jest.fn().mockResolvedValue([
    {
      shipmentId:     "SHP-TEST01",
      origin:         "Shanghai, CN",
      destination:    "Rotterdam, NL",
      carrier:        "TestCarrier",
      status:         "IN_TRANSIT",
      delayRiskScore: 0.45,
    },
  ]),
  getShipment: jest.fn().mockResolvedValue({
    shipmentId:     "SHP-TEST01",
    origin:         "Shanghai, CN",
    destination:    "Rotterdam, NL",
    status:         "IN_TRANSIT",
    events:         [],
    delayRiskScore: 0.45,
  }),
  recordEvent:       jest.fn().mockResolvedValue({ shipmentId: "SHP-TEST01", events: [] }),
  updateDelayRisk:   jest.fn().mockResolvedValue({}),
  getShipmentHistory: jest.fn().mockResolvedValue([]),
  markDelivered:     jest.fn().mockResolvedValue({ shipmentId: "SHP-TEST01", status: "DELIVERED" }),
}));

// ── Mock ML service ────────────────────────────────────────────────────────
jest.mock("../../backend/services/mlService", () => ({
  predictDelay: jest.fn().mockResolvedValue({
    delay_probability: 0.45,
    risk_level:        "MEDIUM",
    top_factors:       [],
  }),
  healthCheck: jest.fn().mockResolvedValue({ status: "ok" }),
}));

// ── Mock MongoDB ───────────────────────────────────────────────────────────
jest.mock("../../backend/models/ShipmentMeta", () => ({
  create: jest.fn().mockResolvedValue({ shipmentId: "SHP-TEST01", notes: "" }),
  find:   jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
}));

jest.mock("../../backend/utils/db", () => jest.fn());

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/shipments", () => {
  it("returns list of shipments with 200", async () => {
    const res = await request(app).get("/api/shipments");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/shipments/:id", () => {
  it("returns a single shipment", async () => {
    const res = await request(app).get("/api/shipments/SHP-TEST01");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.shipmentId).toBe("SHP-TEST01");
  });
});

describe("POST /api/shipments", () => {
  const validPayload = {
    containerId:      "CONT-NEW01",
    origin:           "Mumbai, IN",
    destination:      "Hamburg, DE",
    carrier:          "GlobalShip Ltd",
    cargoType:        "Textiles",
    weightKg:         8500,
    estimatedArrival: "2024-06-15",
  };

  it("creates a shipment and returns 201", async () => {
    const res = await request(app).post("/api/shipments").send(validPayload);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shipmentId).toBeDefined();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app).post("/api/shipments").send({ containerId: "CONT-BAD" });
    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it("returns 400 for invalid weight", async () => {
    const res = await request(app).post("/api/shipments").send({ ...validPayload, weightKg: -100 });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/shipments/:id/events", () => {
  it("records an event on a shipment", async () => {
    const res = await request(app)
      .post("/api/shipments/SHP-TEST01/events")
      .send({ eventType: "DEPARTED_PORT", location: "Shanghai", description: "Vessel departed" });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 when event fields are missing", async () => {
    const res = await request(app)
      .post("/api/shipments/SHP-TEST01/events")
      .send({ eventType: "DEPARTED_PORT" }); // missing location and description
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/health", () => {
  it("returns health status", async () => {
    const res = await request(app).get("/api/health");
    expect([200, 503]).toContain(res.statusCode);
    expect(res.body.services).toBeDefined();
  });
});
