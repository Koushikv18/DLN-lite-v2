// ─────────────────────────────────────────────────────────────────────────────
// tests/backend/auditChain.test.js
// The independent verifier for a shipment's custody hash chain, and the offline
// CLI built on it. These must agree byte-for-byte with the Go chaincode.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { GENESIS_HASH, eventHash, verifyChain } = require("../../backend/utils/auditChain");

// Same constant as crossLanguageVector in blockchain/chaincode/shipment/shipment_test.go.
// It was produced by THIS implementation; the Go test asserts the chaincode matches it.
const CROSS_LANGUAGE_VECTOR = "8a9e8d4a860d6e5c013150855e4ba464774fa5345863e479e2dea2f85680547b";

const base = (n, extra = {}) => ({
  eventId: `EVT-SHP-1-${n}`,
  eventType: "CHECKPOINT",
  location: `Port ${n}`,
  actor: "Org1MSP",
  timestamp: `2026-01-0${n}T00:00:00Z`,
  description: `step ${n}`,
  txId: `tx-${n}`,
  ...extra,
});

// Build a correctly sealed chain, exactly the way the chaincode does.
function sealChain(count) {
  const events = [];
  let prev = GENESIS_HASH;
  for (let n = 1; n <= count; n += 1) {
    const event = { ...base(n), prevHash: prev };
    event.hash = eventHash(event);
    events.push(event);
    prev = event.hash;
  }
  return events;
}

describe("eventHash", () => {
  it("matches the Go chaincode (shared test vector, includes non-ASCII text)", () => {
    const event = {
      eventId: "EVT-SHP-1-1",
      eventType: "SHIPMENT_CREATED",
      location: "Rotterdam, NL — Café",
      actor: "Org1MSP",
      timestamp: "2026-01-01T00:00:00Z",
      description: "Shipment created. Container CONT-1 ready",
      txId: "tx-test",
      prevHash: GENESIS_HASH,
    };
    expect(eventHash(event)).toBe(CROSS_LANGUAGE_VECTOR);
  });

  it("keeps field boundaries unambiguous", () => {
    expect(eventHash({ eventId: "ab", eventType: "c" })).not.toBe(eventHash({ eventId: "a", eventType: "bc" }));
  });
});

describe("verifyChain", () => {
  it("accepts a correctly sealed chain and reports its head hash", () => {
    const events = sealChain(4);
    const report = verifyChain(events);
    expect(report).toMatchObject({ intact: true, eventCount: 4, hashedEvents: 4, legacyEvents: 0, brokenAtIndex: -1 });
    expect(report.headHash).toBe(events[3].hash);
  });

  it("accepts an empty history", () => {
    expect(verifyChain([]).intact).toBe(true);
  });

  const tamperings = [
    ["an edited description", (e) => { e[1].description = "forged"; return e; }, 1],
    ["an edited location", (e) => { e[2].location = "Singapore"; return e; }, 2],
    ["an edited actor", (e) => { e[1].actor = "EvilOrgMSP"; return e; }, 1],
    ["a deleted middle event", (e) => { e.splice(1, 1); return e; }, 1],
    ["re-ordered events", (e) => { [e[1], e[2]] = [e[2], e[1]]; return e; }, 1],
    ["a stripped hash", (e) => { delete e[2].hash; return e; }, 2],
    ["a forged link", (e) => { e[2].prevHash = GENESIS_HASH; return e; }, 2],
  ];

  it.each(tamperings)("detects %s", (_name, mutate, brokenAt) => {
    const report = verifyChain(mutate(sealChain(4)));
    expect(report.intact).toBe(false);
    expect(report.brokenAtIndex).toBe(brokenAt);
    expect(report.reason).not.toBe("");
  });

  it("catches a forger who edits an event AND recomputes its hash, at the next event", () => {
    const events = sealChain(4);
    events[1].description = "forged";
    events[1].hash = eventHash(events[1]);
    const report = verifyChain(events);
    expect(report.intact).toBe(false);
    expect(report.brokenAtIndex).toBe(2);
  });

  it("tolerates legacy (unsealed) events only at the very start", () => {
    const events = sealChain(3);
    const legacy = base(0);
    expect(verifyChain([legacy, ...events]).legacyEvents).toBe(1);
    expect(verifyChain([legacy, ...events]).intact).toBe(true);
    expect(verifyChain([...events, base(9)]).intact).toBe(false); // unsealed event AFTER sealed ones
  });
});

describe("scripts/verifyExport.js (offline CLI)", () => {
  const cli = path.join(__dirname, "../../scripts/verifyExport.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dln-audit-"));
  const write = (name, content) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    return file;
  };
  const run = (file) => spawnSync("node", [cli, ...(file ? [file] : [])], { encoding: "utf8" });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("exits 0 for an intact record, printing the fingerprint", () => {
    const events = sealChain(3);
    const result = run(write("ok.json", { shipmentId: "SHP-1", events }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("INTACT");
    expect(result.stdout).toContain(events[2].hash);
  });

  it("accepts the { success, data } API response shape", () => {
    const result = run(write("wrapped.json", { success: true, data: { shipmentId: "SHP-1", events: sealChain(2) } }));
    expect(result.status).toBe(0);
  });

  it("exits 1 and names the broken event for a tampered record", () => {
    const events = sealChain(4);
    events[2].location = "Singapore";
    const result = run(write("bad.json", { shipmentId: "SHP-1", events }));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("TAMPERED at event 2");
  });

  it("exits 2 for missing arguments, unreadable files and non-shipment files", () => {
    expect(run().status).toBe(2);
    expect(run(path.join(dir, "missing.json")).status).toBe(2);
    expect(run(write("junk.json", { hello: "world" })).status).toBe(2);
    expect(run(write("notjson.json", "{oops")).status).toBe(2);
  });
});
