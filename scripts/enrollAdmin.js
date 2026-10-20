// ─────────────────────────────────────────────────────────────────────────────
// enrollAdmin.js
// Registers the admin user identity into the local wallet.
// Must be run once before starting the backend server.
//
// Usage: node scripts/enrollAdmin.js
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config({ path: "../backend/.env.example" });

const FabricCAServices = require("fabric-ca-client");
const { Wallets }      = require("fabric-network");
const path             = require("path");
const fs               = require("fs");

const CONNECTION_PROFILE_PATH = path.resolve(__dirname, "../blockchain/network/connection-profile.json");
const WALLET_PATH             = path.resolve(__dirname, "../backend/wallet");

async function main() {
  // Load connection profile
  const ccpJSON = fs.readFileSync(CONNECTION_PROFILE_PATH, "utf8");
  const ccp     = JSON.parse(ccpJSON);

  // Create a new CA client for interacting with the CA
  const caInfo   = ccp.certificateAuthorities["ca.org1.dln.com"];
  const caTLSCACerts = caInfo.tlsCACerts;
  const ca       = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);

  // Create a new wallet
  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
  console.log(`Wallet path: ${WALLET_PATH}`);

  // Check if admin already enrolled
  const identity = await wallet.get("admin");
  if (identity) {
    console.log("✅ Admin identity already exists in wallet. Skipping enrollment.");
    return;
  }

  // Enroll the admin user
  const enrollment = await ca.enroll({
    enrollmentID:     "admin",
    enrollmentSecret: "adminpw",
  });

  const x509Identity = {
    credentials: {
      certificate: enrollment.certificate,
      privateKey:  enrollment.key.toBytes(),
    },
    mspId: "Org1MSP",
    type:  "X.509",
  };

  await wallet.put("admin", x509Identity);
  console.log("✅ Admin identity enrolled and stored in wallet successfully.");
  console.log("   You can now start the backend server: npm run dev");
}

main().catch((err) => {
  console.error("❌ Enrollment failed:", err);
  process.exit(1);
});
