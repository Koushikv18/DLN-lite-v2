// ─────────────────────────────────────────────────────────────────────────────
// shipment_test.go
// Unit tests for the Hyperledger Fabric chaincode.
// Uses the fabric-chaincode-go mock stub — no real blockchain needed.
// Run with: go test ./...
// ─────────────────────────────────────────────────────────────────────────────

package main

import (
	"encoding/json"
	"testing"

	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-chaincode-go/shimtest"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ── Test helpers ──────────────────────────────────────────────────────────

func setupChaincode(t *testing.T) (*SmartContract, *shimtest.MockStub) {
	chaincode, err := contractapi.NewChaincode(&SmartContract{})
	require.NoError(t, err)

	stub := shimtest.NewMockStub("shipment-test", chaincode)
	stub.MockTransactionStart("init-tx")

	sc := &SmartContract{}
	return sc, stub
}

// ── InitLedger ────────────────────────────────────────────────────────────

func TestInitLedger(t *testing.T) {
	_, stub := setupChaincode(t)

	res := stub.MockInvoke("tx-init", [][]byte{
		[]byte("InitLedger"),
	})

	assert.Equal(t, shim.OK, int(res.Status), "InitLedger should return OK")
}

// ── CreateShipment ────────────────────────────────────────────────────────

func TestCreateShipment_Success(t *testing.T) {
	_, stub := setupChaincode(t)

	// Init first
	stub.MockInvoke("tx-0", [][]byte{[]byte("InitLedger")})

	res := stub.MockInvoke("tx-1", [][]byte{
		[]byte("CreateShipment"),
		[]byte("SHP-UNIT-001"),
		[]byte("CONT-TEST"),
		[]byte("Shanghai, CN"),
		[]byte("Rotterdam, NL"),
		[]byte("TestCarrier"),
		[]byte("Electronics"),
		[]byte("10000"),
		[]byte("2024-06-01T00:00:00Z"),
	})

	assert.Equal(t, shim.OK, int(res.Status), res.Message)

	var shipment Shipment
	err := json.Unmarshal(res.Payload, &shipment)
	require.NoError(t, err)

	assert.Equal(t, "SHP-UNIT-001", shipment.ShipmentID)
	assert.Equal(t, "Shanghai, CN", shipment.Origin)
	assert.Equal(t, "Rotterdam, NL", shipment.Destination)
	assert.Equal(t, StatusCreated, shipment.Status)
	assert.Len(t, shipment.Events, 1)
	assert.Equal(t, "SHIPMENT_CREATED", shipment.Events[0].EventType)
}

func TestCreateShipment_DuplicateFails(t *testing.T) {
	_, stub := setupChaincode(t)
	stub.MockInvoke("tx-0", [][]byte{[]byte("InitLedger")})

	args := [][]byte{
		[]byte("CreateShipment"),
		[]byte("SHP-DUP"),
		[]byte("CONT-DUP"),
		[]byte("Mumbai, IN"),
		[]byte("Hamburg, DE"),
		[]byte("Carrier"),
		[]byte("General"),
		[]byte("5000"),
		[]byte("2024-07-01T00:00:00Z"),
	}

	res1 := stub.MockInvoke("tx-1", args)
	assert.Equal(t, shim.OK, int(res1.Status))

	// Second call with same ID should fail
	res2 := stub.MockInvoke("tx-2", args)
	assert.Equal(t, shim.ERROR, int(res2.Status))
	assert.Contains(t, res2.Message, "already exists")
}

// ── GetShipment ───────────────────────────────────────────────────────────

func TestGetShipment_NotFound(t *testing.T) {
	_, stub := setupChaincode(t)
	stub.MockInvoke("tx-0", [][]byte{[]byte("InitLedger")})

	res := stub.MockInvoke("tx-1", [][]byte{
		[]byte("GetShipment"),
		[]byte("SHP-DOES-NOT-EXIST"),
	})

	assert.Equal(t, shim.ERROR, int(res.Status))
	assert.Contains(t, res.Message, "does not exist")
}

// ── RecordEvent ───────────────────────────────────────────────────────────

func TestRecordEvent_AppendsEvent(t *testing.T) {
	_, stub := setupChaincode(t)
	stub.MockInvoke("tx-0", [][]byte{[]byte("InitLedger")})

	// Create a shipment first
	stub.MockInvoke("tx-1", [][]byte{
		[]byte("CreateShipment"),
		[]byte("SHP-EVT-001"),
		[]byte("CONT-E"),
		[]byte("Singapore"),
		[]byte("Los Angeles, US"),
		[]byte("MarineX"),
		[]byte("Machinery"),
		[]byte("15000"),
		[]byte("2024-08-01T00:00:00Z"),
	})

	// Record an event
	res := stub.MockInvoke("tx-2", [][]byte{
		[]byte("RecordEvent"),
		[]byte("SHP-EVT-001"),
		[]byte("DEPARTED_PORT"),
		[]byte("Singapore Port"),
		[]byte("Vessel departed on time"),
	})

	assert.Equal(t, shim.OK, int(res.Status), res.Message)

	var shipment Shipment
	err := json.Unmarshal(res.Payload, &shipment)
	require.NoError(t, err)

	// Should have 2 events now: SHIPMENT_CREATED + DEPARTED_PORT
	assert.Len(t, shipment.Events, 2)
	assert.Equal(t, "DEPARTED_PORT", shipment.Events[1].EventType)
	assert.Equal(t, StatusInTransit, shipment.Status)
}

// ── UpdateDelayRisk ───────────────────────────────────────────────────────

func TestUpdateDelayRisk_StoresScore(t *testing.T) {
	_, stub := setupChaincode(t)
	stub.MockInvoke("tx-0", [][]byte{[]byte("InitLedger")})

	stub.MockInvoke("tx-1", [][]byte{
		[]byte("CreateShipment"),
		[]byte("SHP-RISK-001"),
		[]byte("CONT-R"),
		[]byte("Dubai, UAE"),
		[]byte("Felixstowe, UK"),
		[]byte("AquaLine"),
		[]byte("Food"),
		[]byte("7000"),
		[]byte("2024-09-01T00:00:00Z"),
	})

	res := stub.MockInvoke("tx-2", [][]byte{
		[]byte("UpdateDelayRisk"),
		[]byte("SHP-RISK-001"),
		[]byte("0.72"),
	})

	assert.Equal(t, shim.OK, int(res.Status), res.Message)

	var shipment Shipment
	err := json.Unmarshal(res.Payload, &shipment)
	require.NoError(t, err)

	assert.InDelta(t, 0.72, shipment.DelayRiskScore, 0.001)
}

func TestUpdateDelayRisk_HighScoreChangesStatus(t *testing.T) {
	_, stub := setupChaincode(t)
	stub.MockInvoke("tx-0", [][]byte{[]byte("InitLedger")})

	// Create and put in transit
	stub.MockInvoke("tx-1", [][]byte{
		[]byte("CreateShipment"),
		[]byte("SHP-RISK-002"),
		[]byte("CONT-R2"),
		[]byte("Busan, KR"),
		[]byte("Rotterdam, NL"),
		[]byte("SeaRoute Express"),
		[]byte("Chemicals"),
		[]byte("11000"),
		[]byte("2024-10-01T00:00:00Z"),
	})
	stub.MockInvoke("tx-2", [][]byte{
		[]byte("RecordEvent"),
		[]byte("SHP-RISK-002"),
		[]byte("DEPARTED_PORT"),
		[]byte("Busan"),
		[]byte("Departed"),
	})

	// Score ≥ 0.85 should trigger DELAYED status
	res := stub.MockInvoke("tx-3", [][]byte{
		[]byte("UpdateDelayRisk"),
		[]byte("SHP-RISK-002"),
		[]byte("0.90"),
	})

	var shipment Shipment
	json.Unmarshal(res.Payload, &shipment)
	assert.Equal(t, StatusDelayed, shipment.Status)
}

// ── MarkDelivered ─────────────────────────────────────────────────────────

func TestMarkDelivered(t *testing.T) {
	_, stub := setupChaincode(t)
	stub.MockInvoke("tx-0", [][]byte{[]byte("InitLedger")})

	stub.MockInvoke("tx-1", [][]byte{
		[]byte("CreateShipment"),
		[]byte("SHP-DEL-001"),
		[]byte("CONT-D"),
		[]byte("Shanghai, CN"),
		[]byte("Hamburg, DE"),
		[]byte("GlobalShip Ltd"),
		[]byte("Textiles"),
		[]byte("9000"),
		[]byte("2024-05-01T00:00:00Z"),
	})

	res := stub.MockInvoke("tx-2", [][]byte{
		[]byte("MarkDelivered"),
		[]byte("SHP-DEL-001"),
	})

	assert.Equal(t, shim.OK, int(res.Status), res.Message)

	var shipment Shipment
	json.Unmarshal(res.Payload, &shipment)
	assert.Equal(t, StatusDelivered, shipment.Status)
	assert.NotEmpty(t, shipment.ActualArrival)
}
