#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# stop-network.sh
# Stops all Docker containers and cleans up generated artifacts.
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "============================================"
echo " DLN-Lite Network Teardown"
echo "============================================"

echo ""
echo "🛑 Stopping Fabric containers..."
docker-compose -f ../../docker/fabric-docker-compose.yml down --volumes --remove-orphans

echo ""
echo "🗑️  Removing generated crypto material..."
rm -rf ./crypto-config
rm -rf ./channel-artifacts/*.block
rm -rf ./channel-artifacts/*.tx

echo ""
echo "🗑️  Removing chaincode Docker images..."
docker rmi $(docker images dev-* -q) 2>/dev/null || true

echo ""
echo "============================================"
echo " ✅ Network stopped and cleaned"
echo "============================================"
