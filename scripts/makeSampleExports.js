#!/usr/bin/env node
// Generates docs/sample/*.json: a realistic shipment exported from the ledger,
// plus a copy where one custody event was altered after the fact.
// Reproduce with: node scripts/makeSampleExports.js
//
// The hash chain is built with the same algorithm the chaincode uses
// (backend/utils/auditChain.js is verified against the Go implementation by a
// shared test vector).

const fs = require("fs");
const path = require("path");
const { GENESIS_HASH, eventHash } = require("../backend/utils/auditChain");

const steps = [
  ["SHIPMENT_CREATED", "Shanghai, CN", "Org1MSP", "2026-03-02T08:00:00Z", "Shipment created. Container CONT-4821 ready at Shanghai, CN"],
  ["CUSTODY_TRANSFERRED", "Shanghai, CN", "Org1MSP", "2026-03-02T14:30:00Z", "Custody transferred from Org1MSP to OceanFreight Co at Shanghai, CN"],
  ["DEPARTED_PORT", "Shanghai, CN", "Org1MSP", "2026-03-03T06:10:00Z", "Vessel departed origin terminal"],
  ["CHECKPOINT_1", "Suez Canal", "Org1MSP", "2026-03-19T21:45:00Z", "Shipment reached checkpoint 1"],
  ["ARRIVED_PORT", "Rotterdam, NL", "Org1MSP", "2026-04-01T05:20:00Z", "Shipment arrived at destination and entered customs queue"],
  ["CUSTOMS_CLEARED", "Rotterdam, NL", "Org1MSP", "2026-04-02T10:05:00Z", "Customs cleared by inspection terminal"],
];

const events = [];
let prev = GENESIS_HASH;
steps.forEach(([eventType, location, actor, timestamp, description], i) => {
  const event = {
    eventId: `EVT-SHP-4821-${i + 1}`, eventType, location, actor, timestamp, description,
    txId: `tx${String(i + 1).padStart(2, "0")}${"ab12cd34".repeat(7)}`.slice(0, 64),
    prevHash: prev,
  };
  event.hash = eventHash(event);
  events.push(event);
  prev = event.hash;
});

const shipment = {
  shipmentId: "SHP-4821", containerId: "CONT-4821", origin: "Shanghai, CN", destination: "Rotterdam, NL",
  carrier: "OceanFreight Co", shipper: "Org1MSP", currentHolder: "OceanFreight Co", status: "IN_CUSTOMS",
  events, cargoType: "Electronics", weightKg: 12500, createdAt: "2026-03-02T08:00:00Z",
  estimatedArrival: "2026-04-02T00:00:00Z", delayRiskScore: 0.32,
};

// The tampered copy: someone rewrites WHEN the cargo cleared customs and who handled it.
const tampered = JSON.parse(JSON.stringify(shipment));
tampered.events[3].location = "Port Said, EG";
tampered.events[3].description = "Shipment reached checkpoint 1 (rerouted; inspection skipped)";

const dir = path.join(__dirname, "../docs/sample");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "shipment-intact.json"), JSON.stringify(shipment, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "shipment-tampered.json"), JSON.stringify(tampered, null, 2) + "\n");
console.log("Wrote docs/sample/shipment-intact.json and docs/sample/shipment-tampered.json");
