// ─────────────────────────────────────────────────────────────────────────────
// auditChain.js — independent verifier for a shipment's custody hash chain.
//
// The chaincode seals every event with SHA-256(fields + previous hash). This
// module re-computes the same hashes from plain data, so a customs officer, an
// auditor or a court can check an exported shipment record WITHOUT access to
// the blockchain, the backend database or this project's servers.
//
// MUST stay byte-for-byte compatible with eventHash() in
// blockchain/chaincode/shipment/shipment.go (a shared test vector enforces it).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");

const GENESIS_HASH = "0".repeat(64);

// Field order matters and is part of the format.
const HASHED_FIELDS = ["eventId", "eventType", "location", "actor", "timestamp", "description", "txId", "prevHash"];

function eventHash(event) {
  const h = crypto.createHash("sha256");
  for (const name of HASHED_FIELDS) {
    const value = event[name] == null ? "" : String(event[name]);
    // Length-prefixed (in UTF-8 bytes) so ("ab","c") and ("a","bc") hash differently.
    h.update(`${Buffer.byteLength(value, "utf8")}:${value}|`);
  }
  return h.digest("hex");
}

function verifyChain(events = []) {
  const report = {
    intact: true,
    eventCount: events.length,
    hashedEvents: 0,
    legacyEvents: 0,
    headHash: GENESIS_HASH,
    brokenAtIndex: -1,
    reason: "",
  };
  let prev = GENESIS_HASH;
  let sealedSeen = false;

  const fail = (index, reason) => ({ ...report, intact: false, brokenAtIndex: index, reason });

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event.hash) {
      if (sealedSeen) return fail(i, `event ${i} has no hash but follows sealed events (hash stripped)`);
      report.legacyEvents += 1; // written before sealing existed
      continue;
    }
    sealedSeen = true;
    if (event.prevHash !== prev) {
      return fail(i, `event ${i} does not link to the previous event (an event was removed, inserted or re-ordered)`);
    }
    if (eventHash(event) !== event.hash) {
      return fail(i, `event ${i} content does not match its hash (event was edited)`);
    }
    report.hashedEvents += 1;
    prev = event.hash;
    report.headHash = event.hash;
  }
  return report;
}

module.exports = { GENESIS_HASH, eventHash, verifyChain };
