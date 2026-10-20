// ─────────────────────────────────────────────────────────────────────────────
// seedData.js
// Creates a realistic set of sample shipments on the blockchain for demo/testing.
// Usage: node scripts/seedData.js
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const axios = require("axios");

const API_BASE = "http://localhost:4000/api";

const SAMPLE_SHIPMENTS = [
  {
    containerId:      "CONT-SH001",
    origin:           "Shanghai, CN",
    destination:      "Rotterdam, NL",
    carrier:          "OceanFreight Co",
    cargoType:        "Electronics",
    weightKg:         14200,
    estimatedArrival: "2024-03-15",
    notes:            "Priority tech shipment — temperature sensitive packaging",
    contactEmail:     "logistics@techcorp.com",
  },
  {
    containerId:      "CONT-MU002",
    origin:           "Mumbai, IN",
    destination:      "Felixstowe, UK",
    carrier:          "GlobalShip Ltd",
    cargoType:        "Textiles",
    weightKg:         9800,
    estimatedArrival: "2024-03-28",
    notes:            "Seasonal clothing — time-sensitive for spring collection",
    contactEmail:     "supply@fashionco.com",
  },
  {
    containerId:      "CONT-SG003",
    origin:           "Singapore",
    destination:      "Los Angeles, US",
    carrier:          "MarineX",
    cargoType:        "Machinery",
    weightKg:         22000,
    estimatedArrival: "2024-04-02",
    notes:            "Heavy industrial equipment — special handling required",
    contactEmail:     "ops@industrialco.com",
  },
  {
    containerId:      "CONT-DU004",
    origin:           "Dubai, UAE",
    destination:      "Hamburg, DE",
    carrier:          "AquaLine",
    cargoType:        "Food",
    weightKg:         6500,
    estimatedArrival: "2024-03-20",
    notes:            "Perishable goods — cold chain maintained",
    contactEmail:     "fresh@foodexport.ae",
  },
  {
    containerId:      "CONT-BS005",
    origin:           "Busan, KR",
    destination:      "Rotterdam, NL",
    carrier:          "SeaRoute Express",
    cargoType:        "Chemicals",
    weightKg:         11000,
    estimatedArrival: "2024-04-10",
    notes:            "Hazmat class 3 — MSDS documents attached",
    contactEmail:     "safety@chemco.kr",
  },
];

const SAMPLE_EVENTS = {
  "CONT-SH001": [
    { eventType: "DEPARTED_PORT",  location: "Shanghai Port",    description: "Container loaded — vessel MSC Beatrice departed" },
    { eventType: "ARRIVED_PORT",   location: "Port of Singapore", description: "Transit stop — refuelling and inspection" },
  ],
  "CONT-MU002": [
    { eventType: "DEPARTED_PORT",  location: "Nhava Sheva, Mumbai", description: "All 3 containers loaded and sealed" },
  ],
  "CONT-SG003": [
    { eventType: "DEPARTED_PORT",  location: "Singapore Port",    description: "Vessel departed with heavy lift equipment" },
    { eventType: "ARRIVED_PORT",   location: "Colombo, Sri Lanka", description: "Short transit — no unloading" },
    { eventType: "DEPARTED_PORT",  location: "Colombo, Sri Lanka", description: "Resumed voyage to Los Angeles" },
  ],
};

async function seed() {
  console.log("🌱 DLN-Lite Data Seeder");
  console.log("========================");
  console.log(`Seeding ${SAMPLE_SHIPMENTS.length} shipments to ${API_BASE}\n`);

  const createdIds = [];

  // Create all shipments
  for (const shipment of SAMPLE_SHIPMENTS) {
    try {
      const res = await axios.post(`${API_BASE}/shipments`, shipment);
      const id  = res.data.data.shipmentId;
      createdIds.push({ id, containerId: shipment.containerId });
      console.log(`✅ Created: ${id} (${shipment.containerId}) — ${shipment.origin} → ${shipment.destination}`);
    } catch (err) {
      console.error(`❌ Failed to create ${shipment.containerId}:`, err.response?.data?.error || err.message);
    }
  }

  // Wait a moment for blockchain transactions to settle
  console.log("\n⏳ Waiting 3s for blockchain to process...");
  await new Promise((r) => setTimeout(r, 3000));

  // Record events for some shipments
  console.log("\n📋 Recording events...");
  for (const { id, containerId } of createdIds) {
    const events = SAMPLE_EVENTS[containerId];
    if (!events) continue;

    for (const event of events) {
      try {
        await axios.post(`${API_BASE}/shipments/${id}/events`, event);
        console.log(`  ✅ Event recorded: ${event.eventType} for ${id}`);
        await new Promise((r) => setTimeout(r, 500)); // small delay between tx
      } catch (err) {
        console.error(`  ❌ Event failed for ${id}:`, err.response?.data?.error || err.message);
      }
    }
  }

  // Trigger ML batch update
  console.log("\n🤖 Triggering ML risk score update...");
  try {
    const ml = await axios.get(`${API_BASE}/ml/batch-update`);
    console.log(`✅ ML batch complete: ${ml.data.updated} shipments scored`);
  } catch (err) {
    console.warn("⚠️  ML update skipped (ML service may not be running):", err.message);
  }

  console.log("\n🎉 Seeding complete!");
  console.log(`   ${createdIds.length} shipments created on blockchain`);
  console.log("   Open http://localhost:3000 to view the dashboard");
}

seed().catch((err) => {
  console.error("Seeder crashed:", err.message);
  process.exit(1);
});
