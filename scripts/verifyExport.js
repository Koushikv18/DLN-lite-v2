#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verifyExport.js — check a shipment's custody trail OFFLINE.
//
//   node scripts/verifyExport.js shipment.json
//
// Accepts a shipment record exported from the API (either the bare shipment or
// the { success, data } response). Needs no blockchain, database or network:
// it recomputes the SHA-256 hash chain from the file alone.
// Exit code 0 = intact, 1 = tampered, 2 = usage / unreadable file.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const { verifyChain } = require("../backend/utils/auditChain");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/verifyExport.js <shipment.json>");
  process.exit(2);
}

let record;
try {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  record = parsed.data && parsed.data.events ? parsed.data : parsed;
} catch (error) {
  console.error(`Could not read ${file}: ${error.message}`);
  process.exit(2);
}

if (!Array.isArray(record.events)) {
  console.error("This file has no 'events' array: is it a shipment record?");
  process.exit(2);
}

const report = verifyChain(record.events);
console.log(`Shipment      : ${record.shipmentId || "(unknown)"}`);
console.log(`Events        : ${report.eventCount} (${report.hashedEvents} sealed, ${report.legacyEvents} legacy)`);
console.log(`Head hash     : ${report.headHash}`);
if (report.intact) {
  console.log("Result        : INTACT — every event matches its hash and links to the one before it");
  process.exit(0);
}
console.log(`Result        : TAMPERED at event ${report.brokenAtIndex} — ${report.reason}`);
process.exit(1);
