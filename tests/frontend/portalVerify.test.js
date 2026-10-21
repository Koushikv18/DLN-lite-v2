// ─────────────────────────────────────────────────────────────────────────────
// tests/frontend/portalVerify.test.js
// Regression tests for the portal's integrity-verification tool.
//
// The portal is one big HTML file, so these tests pull the real functions out of
// it and run them against simulated API answers. The bug they guard against:
// the tool used to print "Integrity verified" even when the check itself failed.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "../../frontend/public/logistics_blockchain_3d.html"), "utf8");

function sliceFunction(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Could not find ${startMarker} in the portal`);
  return html.slice(start, end);
}

const source =
  sliceFunction("function escHtml(value)", "// Always show whether the dashboard") +
  sliceFunction("async function verifyCustomsShipment(id)", "function renderVerificationTool(targetId)");

function runVerify({ apiRequest }) {
  const output = { innerHTML: "" };
  const sandbox = {
    shipments: [{ id: "SHP-1", raw: { shipmentId: "SHP-1", weightKg: 5000 } }],
    apiRequest,
    document: { getElementById: () => output },
    encodeURIComponent,
    JSON,
    String,
    Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}; this.verifyCustomsShipment = verifyCustomsShipment;`, sandbox);
  return sandbox.verifyCustomsShipment("SHP-1").then(() => output.innerHTML);
}

const passResult = { data: { shipmentId: "SHP-1", integrityPass: true, differences: [], txId: "tx1", verifiedAt: "now", ledgerFingerprint: "a".repeat(64) } };
const auditOk = { data: { headHash: "b".repeat(64), agree: true, independent: { intact: true, hashedEvents: 3, eventCount: 3, legacyEvents: 0 } } };

describe("portal integrity verification", () => {
  it("never reports a pass when the verification request itself fails", async () => {
    const out = await runVerify({ apiRequest: () => Promise.reject(new Error("Failed to fetch")) });
    expect(out).toContain("VERIFICATION UNAVAILABLE");
    expect(out).toContain("nothing was verified");
    expect(out).not.toMatch(/INTEGRITY VERIFIED/i);
  });

  it("shows a verified record with an intact, cross-checked custody chain", async () => {
    const out = await runVerify({
      apiRequest: (p) => (p.endsWith("/verify") ? Promise.resolve(passResult) : Promise.resolve(auditOk)),
    });
    expect(out).toContain("INTEGRITY VERIFIED");
    expect(out).toContain("INTACT");
    expect(out).toContain("AGREE");
  });

  it("lists exactly which fields were tampered with", async () => {
    const tampered = {
      data: {
        shipmentId: "SHP-1", integrityPass: false, txId: "tx1", verifiedAt: "now",
        differences: [{ path: "weightKg", onChain: 5000, claimed: 50 }],
      },
    };
    const out = await runVerify({
      apiRequest: (p) => (p.endsWith("/verify") ? Promise.resolve(tampered) : Promise.resolve(auditOk)),
    });
    expect(out).toContain("TAMPER DETECTED (1 field)");
    expect(out).toContain("weightKg");
    expect(out).toContain("5000");
    expect(out).not.toContain("INTEGRITY VERIFIED");
  });

  it("flags a broken custody chain and a disagreement between the two checks", async () => {
    const broken = {
      data: {
        headHash: "c".repeat(64), agree: false,
        independent: { intact: false, brokenAtIndex: 2, reason: "event 2 content does not match its hash", hashedEvents: 1, eventCount: 4, legacyEvents: 0 },
      },
    };
    const out = await runVerify({
      apiRequest: (p) => (p.endsWith("/verify") ? Promise.resolve(passResult) : Promise.resolve(broken)),
    });
    expect(out).toContain("BROKEN at event 2");
    expect(out).toContain("DISAGREE");
  });

  it("still shows the record check if only the audit call fails, without claiming the chain is fine", async () => {
    const out = await runVerify({
      apiRequest: (p) => (p.endsWith("/verify") ? Promise.resolve(passResult) : Promise.reject(new Error("audit down"))),
    });
    expect(out).toContain("INTEGRITY VERIFIED");
    expect(out).toContain("Custody-chain audit unavailable");
    expect(out).not.toContain("INTACT");
  });

  it("escapes ledger text so a malicious description cannot inject HTML", async () => {
    const evil = {
      data: {
        shipmentId: "SHP-1", integrityPass: false, txId: "tx1", verifiedAt: "now",
        differences: [{ path: "events[1].description", onChain: "<img src=x onerror=alert(1)>", claimed: "ok" }],
      },
    };
    const out = await runVerify({
      apiRequest: (p) => (p.endsWith("/verify") ? Promise.resolve(evil) : Promise.resolve(auditOk)),
    });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});
