const { Gateway } = require("fabric-network");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const { MongoWallet } = require("./caService");

const NETWORK_DIR = path.resolve(__dirname, "../../blockchain/network");
const PROFILE_PATH = path.join(NETWORK_DIR, "connection-profile.json");
const CHANNEL_NAME = "dlnchannel";
const CHAINCODE_NAME = "shipment";

// Gateway connection pooling (cache by userId)
const gateways = new Map();

async function getContractForUser(userId) {
  try {
    if (gateways.has(userId)) {
      const g = gateways.get(userId);
      const network = await g.getNetwork(CHANNEL_NAME);
      return network.getContract(CHAINCODE_NAME);
    }

    const ccpPath = PROFILE_PATH;
    const ccp = JSON.parse(fs.readFileSync(ccpPath, "utf8"));

    // Fix relative paths in CCP
    for (const peer in ccp.peers) {
      if (ccp.peers[peer].tlsCACerts && ccp.peers[peer].tlsCACerts.path) {
        ccp.peers[peer].tlsCACerts.path = path.join(NETWORK_DIR, ccp.peers[peer].tlsCACerts.path);
      }
    }
    for (const orderer in ccp.orderers) {
      if (ccp.orderers[orderer].tlsCACerts && ccp.orderers[orderer].tlsCACerts.path) {
        ccp.orderers[orderer].tlsCACerts.path = path.join(NETWORK_DIR, ccp.orderers[orderer].tlsCACerts.path);
      }
    }

    const wallet = new MongoWallet();
    const identityExists = await wallet.get(userId);
    if (!identityExists) {
      throw new Error(`User ${userId} does not have a valid Fabric identity in the wallet.`);
    }

    const gateway = new Gateway();
    await gateway.connect(ccp, {
      wallet,
      identity: userId,
      discovery: { enabled: true, asLocalhost: true },
    });

    gateways.set(userId, gateway);

    const network = await gateway.getNetwork(CHANNEL_NAME);
    const contract = network.getContract(CHAINCODE_NAME);

    logger.info(`Successfully connected to Fabric network as user: ${userId}`);
    return contract;
  } catch (error) {
    logger.error(`Failed to connect to Fabric for user ${userId}: ${error.message}`);
    throw error;
  }
}

function parseResponse(resultBuffer) {
  if (!resultBuffer || resultBuffer.length === 0) return null;
  return JSON.parse(resultBuffer.toString("utf8"));
}

module.exports = {
  async getContract(userId) {
    return await getContractForUser(userId);
  },

  async createShipment(userId, data) {
    const { shipmentId, containerId, origin, destination, carrier, cargoType, weightKg, estimatedArrival } = data;
    const c = await this.getContract(userId);
    const result = await c.submitTransaction("CreateShipment", shipmentId, containerId, origin, destination, carrier, cargoType, weightKg.toString(), estimatedArrival);
    return parseResponse(result);
  },

  async getShipment(userId, id) {
    const c = await this.getContract(userId);
    const result = await c.evaluateTransaction("GetShipment", id);
    return parseResponse(result);
  },

  async getAllShipments(userId) {
    const c = await this.getContract(userId);
    const result = await c.evaluateTransaction("GetAllShipments");
    return parseResponse(result);
  },

  async recordEvent(userId, shipmentId, eventType, location, description) {
    const c = await this.getContract(userId);
    const result = await c.submitTransaction("RecordEvent", shipmentId, eventType, location, description);
    return parseResponse(result);
  },

  async transferCustody(userId, shipmentId, newHolder, location) {
    const c = await this.getContract(userId);
    const result = await c.submitTransaction("TransferCustody", shipmentId, newHolder, location);
    return parseResponse(result);
  },

  async updateDelayRisk(userId, shipmentId, riskScore) {
    const c = await this.getContract(userId);
    const result = await c.submitTransaction("UpdateDelayRisk", shipmentId, riskScore.toString());
    return parseResponse(result);
  },

  async markDelivered(userId, shipmentId) {
    const c = await this.getContract(userId);
    const result = await c.submitTransaction("MarkDelivered", shipmentId);
    return parseResponse(result);
  },

  async getShipmentHistory(userId, shipmentId) {
    const c = await this.getContract(userId);
    const result = await c.evaluateTransaction("GetShipmentHistory", shipmentId);
    return parseResponse(result);
  },

  async updateStatus(userId, shipmentId, newStatus, reason) {
    const c = await this.getContract(userId);
    const result = await c.submitTransaction("UpdateStatus", shipmentId, newStatus, reason || "");
    return parseResponse(result);
  },

  async verifyIntegrity(userId, shipmentId, claimedDataJSON) {
    const c = await this.getContract(userId);
    const result = await c.evaluateTransaction("VerifyIntegrity", shipmentId, claimedDataJSON);
    return parseResponse(result);
  }
};
