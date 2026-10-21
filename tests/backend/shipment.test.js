// ─────────────────────────────────────────────────────────────────────────────
// tests/backend/shipment.test.js
// Integration tests for the shipment REST API.
// Uses supertest to hit the Express routes directly.
// Mock the fabricService so tests don't need a real blockchain.
// ─────────────────────────────────────────────────────────────────────────────

const request = require("supertest");
const app     = require("../../backend/server");
const fabricService = require("../../backend/services/fabricService");
const ShipmentMeta  = require("../../backend/models/ShipmentMeta");

// Sign requests in as a given role. Tokens map to mock users below.
const as = (role) => ({ Authorization: `Bearer ${role}-token` });
const EMAIL = (role) => `${role}@dln.test`;

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
  transferCustody:   jest.fn().mockResolvedValue({ shipmentId: "SHP-TEST01", currentHolder: "NewHolder" }),
  updateStatus:      jest.fn().mockResolvedValue({ shipmentId: "SHP-TEST01", status: "DELAYED" }),
  verifyIntegrity:   jest.fn().mockResolvedValue({ intact: true }),
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
  // Mongoose queries are chainable (.find(...).lean()), so the mock must be too.
  find:   jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
  findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
}));

jest.mock("../../backend/utils/db", () => ({
  connectDB: jest.fn(),
  getDatabaseMode: jest.fn(() => "mongodb"),
}));

// ── Mock sessions: the real auth middleware runs against these users ───────
jest.mock("../../backend/models/AuthUser", () => {
  const crypto = require("crypto");
  const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
  const future = new Date(Date.now() + 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 3600 * 1000).toISOString();
  const user = (role, expires = future) => ({
    email: `${role}@dln.test`, role, name: role, sessionExpiresAt: expires,
  });
  const sessions = {
    [hash("shipper-token")]: user("shipper"),
    [hash("carrier-token")]: user("carrier"),
    [hash("customs-token")]: user("customs"),
    [hash("expired-token")]: user("shipper", past),
  };
  return {
    findOne: jest.fn((query) => ({
      lean: () => Promise.resolve(sessions[query.sessionTokenHash] || null),
    })),
  };
});

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/shipments", () => {
  it("returns list of shipments with 200", async () => {
    const res = await request(app).get("/api/shipments").set(as("carrier"));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/shipments/:id", () => {
  it("returns a single shipment", async () => {
    const res = await request(app).get("/api/shipments/SHP-TEST01").set(as("carrier"));
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
    const res = await request(app).post("/api/shipments").set(as("shipper")).send(validPayload);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shipmentId).toBeDefined();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app).post("/api/shipments").set(as("shipper")).send({ containerId: "CONT-BAD" });
    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it("returns 400 for invalid weight", async () => {
    const res = await request(app).post("/api/shipments").set(as("shipper")).send({ ...validPayload, weightKg: -100 });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/shipments/:id/events", () => {
  it("records an event on a shipment", async () => {
    const res = await request(app)
      .post("/api/shipments/SHP-TEST01/events")
      .set(as("carrier"))
      .send({ eventType: "DEPARTED_PORT", location: "Shanghai", description: "Vessel departed" });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 when event fields are missing", async () => {
    const res = await request(app)
      .post("/api/shipments/SHP-TEST01/events")
      .set(as("carrier"))
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

// ─────────────────────────────────────────────────────────────────────────────
// Security: authentication, identity propagation and role-based access
// ─────────────────────────────────────────────────────────────────────────────

describe("Authentication", () => {
  it.each([
    ["GET",  "/api/shipments"],
    ["GET",  "/api/shipments/SHP-TEST01"],
    ["POST", "/api/shipments"],
    ["POST", "/api/shipments/SHP-TEST01/deliver"],
    ["GET",  "/api/ml/batch-update"],
    ["GET",  "/api/analytics/summary"],
  ])("rejects %s %s without a token (401)", async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown token", async () => {
    const res = await request(app).get("/api/shipments").set({ Authorization: "Bearer nope" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired session", async () => {
    const res = await request(app).get("/api/shipments").set({ Authorization: "Bearer expired-token" });
    expect(res.statusCode).toBe(401);
  });

  it("never reaches the blockchain when unauthenticated", async () => {
    await request(app).get("/api/shipments");
    expect(fabricService.getAllShipments).not.toHaveBeenCalled();
  });

  it("keeps the health check public", async () => {
    const res = await request(app).get("/api/health");
    expect(res.statusCode).not.toBe(401);
  });
});

describe("Every blockchain call is made as the signed-in user", () => {
  it("passes the user's identity when listing and reading shipments", async () => {
    await request(app).get("/api/shipments").set(as("carrier"));
    expect(fabricService.getAllShipments).toHaveBeenCalledWith(EMAIL("carrier"));

    await request(app).get("/api/shipments/SHP-TEST01").set(as("customs"));
    expect(fabricService.getShipment).toHaveBeenCalledWith(EMAIL("customs"), "SHP-TEST01");
  });

  it("passes the identity on create, and scores risk as that same user", async () => {
    const payload = {
      containerId: "CONT-NEW01", origin: "Mumbai, IN", destination: "Hamburg, DE",
      carrier: "GlobalShip Ltd", cargoType: "Textiles", weightKg: 8500, estimatedArrival: "2024-06-15",
    };
    const res = await request(app).post("/api/shipments").set(as("shipper")).send(payload);
    expect(res.statusCode).toBe(201);
    expect(fabricService.createShipment).toHaveBeenCalledWith(
      EMAIL("shipper"),
      expect.objectContaining({ containerId: "CONT-NEW01" })
    );

    await new Promise((resolve) => setImmediate(resolve)); // let the async risk update run
    expect(fabricService.updateDelayRisk).toHaveBeenCalledWith(EMAIL("shipper"), expect.any(String), 0.45);
  });

  it("records createdBy from the session, not from a client header", async () => {
    const payload = {
      containerId: "CONT-NEW02", origin: "Mumbai, IN", destination: "Hamburg, DE",
      carrier: "GlobalShip Ltd", cargoType: "Textiles", weightKg: 100, estimatedArrival: "2024-06-15",
    };
    await request(app).post("/api/shipments").set(as("shipper")).set("x-user-org", "Spoofed").send(payload);
    expect(ShipmentMeta.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: EMAIL("shipper") }));
  });

  it("passes the identity on events, history, transfer, delivery and status", async () => {
    await request(app).post("/api/shipments/SHP-TEST01/events").set(as("carrier"))
      .send({ eventType: "DEPARTED_PORT", location: "Shanghai", description: "Departed" });
    expect(fabricService.recordEvent).toHaveBeenCalledWith(
      EMAIL("carrier"), "SHP-TEST01", "DEPARTED_PORT", "Shanghai", "Departed"
    );

    await request(app).get("/api/shipments/SHP-TEST01/history").set(as("customs"));
    expect(fabricService.getShipmentHistory).toHaveBeenCalledWith(EMAIL("customs"), "SHP-TEST01");

    await request(app).post("/api/shipments/SHP-TEST01/transfer").set(as("carrier"))
      .send({ newHolder: "Org2MSP", location: "Rotterdam" });
    expect(fabricService.transferCustody).toHaveBeenCalledWith(
      EMAIL("carrier"), "SHP-TEST01", "Org2MSP", "Rotterdam"
    );

    await request(app).post("/api/shipments/SHP-TEST01/deliver").set(as("customs"));
    expect(fabricService.markDelivered).toHaveBeenCalledWith(EMAIL("customs"), "SHP-TEST01");

    await request(app).put("/api/shipments/SHP-TEST01/status").set(as("carrier"))
      .send({ status: "DELAYED", reason: "Storm" });
    expect(fabricService.updateStatus).toHaveBeenCalledWith(EMAIL("carrier"), "SHP-TEST01", "DELAYED", "Storm");
  });
});

describe("Role-based access at the API layer", () => {
  const payload = {
    containerId: "CONT-RBAC", origin: "Mumbai, IN", destination: "Hamburg, DE",
    carrier: "GlobalShip Ltd", cargoType: "Textiles", weightKg: 100, estimatedArrival: "2024-06-15",
  };

  it.each(["carrier", "customs"])("%s cannot create shipments (403)", async (role) => {
    const res = await request(app).post("/api/shipments").set(as(role)).send(payload);
    expect(res.statusCode).toBe(403);
    expect(fabricService.createShipment).not.toHaveBeenCalled();
  });

  it("only a carrier can transfer custody", async () => {
    const body = { newHolder: "Org2MSP", location: "Rotterdam" };
    for (const role of ["shipper", "customs"]) {
      const res = await request(app).post("/api/shipments/SHP-TEST01/transfer").set(as(role)).send(body);
      expect(res.statusCode).toBe(403);
    }
    expect(fabricService.transferCustody).not.toHaveBeenCalled();

    const ok = await request(app).post("/api/shipments/SHP-TEST01/transfer").set(as("carrier")).send(body);
    expect(ok.statusCode).toBe(200);
  });

  it("a shipper cannot mark a shipment delivered; carrier and customs can", async () => {
    const denied = await request(app).post("/api/shipments/SHP-TEST01/deliver").set(as("shipper"));
    expect(denied.statusCode).toBe(403);
    expect(fabricService.markDelivered).not.toHaveBeenCalled();

    for (const role of ["carrier", "customs"]) {
      const ok = await request(app).post("/api/shipments/SHP-TEST01/deliver").set(as(role));
      expect(ok.statusCode).toBe(200);
    }
  });

  it("a shipper cannot overwrite a shipment's status", async () => {
    const res = await request(app).put("/api/shipments/SHP-TEST01/status").set(as("shipper"))
      .send({ status: "DELIVERED", reason: "forged" });
    expect(res.statusCode).toBe(403);
    expect(fabricService.updateStatus).not.toHaveBeenCalled();
  });
});
