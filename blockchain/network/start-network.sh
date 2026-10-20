#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# DLN-Lite Hyperledger Fabric Network Startup Script
# Starts a 2-org network with 1 peer each + 1 orderer
# ─────────────────────────────────────────────────────────────────────────────

set -e

CHANNEL_NAME="dlnchannel"
CHAINCODE_NAME="shipment"
CHAINCODE_VERSION="1.0"
CHAINCODE_PATH="../chaincode/shipment"

echo "============================================"
echo " DLN-Lite Network Startup"
echo "============================================"

# Check prerequisites
if ! command -v docker &>/dev/null; then
    echo "❌ Docker not found. Please install Docker."
    exit 1
fi

# Step 1: Generate crypto material
echo ""
echo "📜 Step 1: Generating crypto material..."
cryptogen generate --config=./crypto-config.yaml --output=./crypto-config

# Step 2: Create genesis block
echo ""
echo "📦 Step 2: Creating genesis block..."
export FABRIC_CFG_PATH=${PWD}
configtxgen -profile ThreeOrgsOrdererGenesis \
    -channelID system-channel \
    -outputBlock ./channel-artifacts/genesis.block

# Step 3: Create channel transaction
echo ""
echo "📡 Step 3: Creating channel transaction..."
configtxgen -profile ThreeOrgsChannel \
    -outputCreateChannelTx ./channel-artifacts/${CHANNEL_NAME}.tx \
    -channelID ${CHANNEL_NAME}

# Step 4: Start Docker network
echo ""
echo "🐳 Step 4: Starting Docker containers..."
docker-compose -f ../../docker/fabric-docker-compose.yml up -d

sleep 5

# Step 5: Create and join channel
echo ""
echo "🔗 Step 5: Creating channel..."
docker exec cli peer channel create \
    -o orderer.dln.com:7050 \
    -c ${CHANNEL_NAME} \
    -f /opt/gopath/src/github.com/hyperledger/fabric/peer/channel-artifacts/${CHANNEL_NAME}.tx \
    --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/dln.com/orderers/orderer.dln.com/msp/tlscacerts/tlsca.dln.com-cert.pem

echo "✅ Org1 joining channel..."
docker exec cli peer channel join -b ${CHANNEL_NAME}.block

echo "✅ Org2 joining channel..."
docker exec -e CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org2.dln.com/users/Admin@org2.dln.com/msp \
    -e CORE_PEER_ADDRESS=peer0.org2.dln.com:9051 \
    -e CORE_PEER_LOCALMSPID="Org2MSP" \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org2.dln.com/peers/peer0.org2.dln.com/tls/ca.crt \
    cli peer channel join -b ${CHANNEL_NAME}.block

# Step 6: Deploy chaincode
echo ""
echo "📋 Step 6: Deploying chaincode..."
docker exec cli peer lifecycle chaincode package ${CHAINCODE_NAME}.tar.gz \
    --path /opt/gopath/src/github.com/chaincode/${CHAINCODE_NAME} \
    --lang golang \
    --label ${CHAINCODE_NAME}_${CHAINCODE_VERSION}

docker exec cli peer lifecycle chaincode install ${CHAINCODE_NAME}.tar.gz

# Get package ID
PACKAGE_ID=$(docker exec cli peer lifecycle chaincode queryinstalled 2>&1 | grep "Package ID" | awk '{print $3}' | tr -d ',')

docker exec cli peer lifecycle chaincode approveformyorg \
    -o orderer.dln.com:7050 \
    --channelID ${CHANNEL_NAME} \
    --name ${CHAINCODE_NAME} \
    --version ${CHAINCODE_VERSION} \
    --package-id ${PACKAGE_ID} \
    --sequence 1 \
    --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/dln.com/orderers/orderer.dln.com/msp/tlscacerts/tlsca.dln.com-cert.pem

echo "✅ Org2 installing chaincode..."
docker exec -e CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org2.dln.com/users/Admin@org2.dln.com/msp \
    -e CORE_PEER_ADDRESS=peer0.org2.dln.com:9051 \
    -e CORE_PEER_LOCALMSPID="Org2MSP" \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org2.dln.com/peers/peer0.org2.dln.com/tls/ca.crt \
    cli peer lifecycle chaincode install ${CHAINCODE_NAME}.tar.gz

echo "✅ Org2 approving chaincode..."
docker exec -e CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org2.dln.com/users/Admin@org2.dln.com/msp \
    -e CORE_PEER_ADDRESS=peer0.org2.dln.com:9051 \
    -e CORE_PEER_LOCALMSPID="Org2MSP" \
    -e CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org2.dln.com/peers/peer0.org2.dln.com/tls/ca.crt \
    cli peer lifecycle chaincode approveformyorg \
    -o orderer.dln.com:7050 \
    --channelID ${CHANNEL_NAME} \
    --name ${CHAINCODE_NAME} \
    --version ${CHAINCODE_VERSION} \
    --package-id ${PACKAGE_ID} \
    --sequence 1 \
    --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/dln.com/orderers/orderer.dln.com/msp/tlscacerts/tlsca.dln.com-cert.pem

docker exec cli peer lifecycle chaincode commit \
    -o orderer.dln.com:7050 \
    --channelID ${CHANNEL_NAME} \
    --name ${CHAINCODE_NAME} \
    --version ${CHAINCODE_VERSION} \
    --sequence 1 \
    --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/dln.com/orderers/orderer.dln.com/msp/tlscacerts/tlsca.dln.com-cert.pem \
    --peerAddresses peer0.org1.dln.com:7051 \
    --tlsRootCertFiles /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org1.dln.com/peers/peer0.org1.dln.com/tls/ca.crt \
    --peerAddresses peer0.org2.dln.com:9051 \
    --tlsRootCertFiles /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org2.dln.com/peers/peer0.org2.dln.com/tls/ca.crt

# Step 7: Initialise ledger
echo ""
echo "🌱 Step 7: Initialising ledger with sample data..."
docker exec cli peer chaincode invoke \
    -o orderer.dln.com:7050 \
    --channelID ${CHANNEL_NAME} \
    --name ${CHAINCODE_NAME} \
    --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/dln.com/orderers/orderer.dln.com/msp/tlscacerts/tlsca.dln.com-cert.pem \
    --peerAddresses peer0.org1.dln.com:7051 \
    --tlsRootCertFiles /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org1.dln.com/peers/peer0.org1.dln.com/tls/ca.crt \
    --peerAddresses peer0.org2.dln.com:9051 \
    --tlsRootCertFiles /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/peerOrganizations/org2.dln.com/peers/peer0.org2.dln.com/tls/ca.crt \
    -c '{"function":"InitLedger","Args":[]}'

echo ""
echo "============================================"
echo " ✅ DLN-Lite Network is UP and RUNNING"
echo " Channel: ${CHANNEL_NAME}"
echo " Chaincode: ${CHAINCODE_NAME}"
echo "============================================"
