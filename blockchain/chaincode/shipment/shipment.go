package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// ─────────────────────────────────────────────────────────────────────────────
// SmartContract — the chaincode struct
// ─────────────────────────────────────────────────────────────────────────────

type SmartContract struct {
	contractapi.Contract
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Models
// ─────────────────────────────────────────────────────────────────────────────

// Shipment represents a container/cargo shipment on the blockchain.
// Only critical events (ownership, status changes) are stored here.
// Bulk sensor data goes to MongoDB off-chain.
type Shipment struct {
	ShipmentID     string          `json:"shipmentId"`
	ContainerID    string          `json:"containerId"`
	Origin         string          `json:"origin"`
	Destination    string          `json:"destination"`
	Carrier        string          `json:"carrier"`
	Shipper        string          `json:"shipper"`       // org that created the shipment
	CurrentHolder  string          `json:"currentHolder"` // org currently responsible
	Status         ShipmentStatus  `json:"status"`
	Events         []ShipmentEvent `json:"events"`
	CargoType      string          `json:"cargoType"`
	WeightKg       float64         `json:"weightKg"`
	CreatedAt      string          `json:"createdAt"`
	EstimatedArrival string        `json:"estimatedArrival"`
	ActualArrival  string          `json:"actualArrival,omitempty" metadata:",optional"`
	DelayRiskScore float64         `json:"delayRiskScore"` // updated by ML service
}

type ShipmentStatus string

const (
	StatusCreated    ShipmentStatus = "CREATED"
	StatusInTransit  ShipmentStatus = "IN_TRANSIT"
	StatusAtPort     ShipmentStatus = "AT_PORT"
	StatusInCustoms  ShipmentStatus = "IN_CUSTOMS"
	StatusDelivered  ShipmentStatus = "DELIVERED"
	StatusDelayed    ShipmentStatus = "DELAYED"
)

// ShipmentEvent represents a critical milestone — stored permanently on chain.
type ShipmentEvent struct {
	EventID     string `json:"eventId"`
	EventType   string `json:"eventType"`   // e.g. "DEPARTED_PORT", "CUSTOMS_CLEARED"
	Location    string `json:"location"`
	Actor       string `json:"actor"`       // which org recorded this event
	Timestamp   string `json:"timestamp"`
	Description string `json:"description"`
	TxID        string `json:"txId"`        // blockchain transaction ID for audit
}

// ─────────────────────────────────────────────────────────────────────────────
// InitLedger — seeds the blockchain with sample shipments for testing
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	shipments := []Shipment{
		{
			ShipmentID:       "SHP-001",
			ContainerID:      "CONT-ABC123",
			Origin:           "Shanghai, CN",
			Destination:      "Rotterdam, NL",
			Carrier:          "OceanFreight Co",
			Shipper:          "Org1MSP",
			CurrentHolder:    "Org1MSP",
			Status:           StatusInTransit,
			CargoType:        "Electronics",
			WeightKg:         12500,
			CreatedAt:        "2024-01-15T08:00:00Z",
			EstimatedArrival: "2024-02-10T00:00:00Z",
			DelayRiskScore:   0.32,
			Events: []ShipmentEvent{
				{
					EventID:     "EVT-001-1",
					EventType:   "DEPARTED_PORT",
					Location:    "Shanghai Port",
					Actor:       "Org1MSP",
					Timestamp:   "2024-01-15T08:00:00Z",
					Description: "Container loaded and vessel departed Shanghai",
					TxID:        "tx_init_001",
				},
			},
		},
		{
			ShipmentID:       "SHP-002",
			ContainerID:      "CONT-XYZ789",
			Origin:           "Mumbai, IN",
			Destination:      "Felixstowe, UK",
			Carrier:          "GlobalShip Ltd",
			Shipper:          "Org2MSP",
			CurrentHolder:    "Org2MSP",
			Status:           StatusAtPort,
			CargoType:        "Textiles",
			WeightKg:         8200,
			CreatedAt:        "2024-01-20T10:00:00Z",
			EstimatedArrival: "2024-02-25T00:00:00Z",
			DelayRiskScore:   0.71,
			Events: []ShipmentEvent{
				{
					EventID:     "EVT-002-1",
					EventType:   "DEPARTED_PORT",
					Location:    "Nhava Sheva Port, Mumbai",
					Actor:       "Org2MSP",
					Timestamp:   "2024-01-20T10:00:00Z",
					Description: "Container departed Mumbai",
					TxID:        "tx_init_002",
				},
				{
					EventID:     "EVT-002-2",
					EventType:   "ARRIVED_PORT",
					Location:    "Port Said, Egypt",
					Actor:       "Org2MSP",
					Timestamp:   "2024-01-28T14:30:00Z",
					Description: "Arrived at transit port",
					TxID:        "tx_init_003",
				},
			},
		},
	}

	for _, shipment := range shipments {
		shipmentJSON, err := json.Marshal(shipment)
		if err != nil {
			return fmt.Errorf("failed to marshal shipment %s: %v", shipment.ShipmentID, err)
		}
		err = ctx.GetStub().PutState(shipment.ShipmentID, shipmentJSON)
		if err != nil {
			return fmt.Errorf("failed to write shipment %s to ledger: %v", shipment.ShipmentID, err)
		}
	}

	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateShipment — records a new shipment on the blockchain
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) CreateShipment(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
	containerID string,
	origin string,
	destination string,
	carrier string,
	cargoType string,
	weightKg float64,
	estimatedArrival string,
) (*Shipment, error) {

	// Check if shipment already exists (prevent duplicates)
	existing, err := ctx.GetStub().GetState(shipmentID)
	if err != nil {
		return nil, fmt.Errorf("failed to read ledger: %v", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("shipment %s already exists", shipmentID)
	}

	// RBAC Check: Only a shipper can create a shipment
	err = ctx.GetClientIdentity().AssertAttributeValue("role", "shipper")
	if err != nil {
		return nil, fmt.Errorf("access denied: only users with the 'shipper' role can create shipments")
	}

	// Get the calling org's identity
	clientOrg, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return nil, fmt.Errorf("failed to get client identity: %v", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)

	shipment := Shipment{
		ShipmentID:       shipmentID,
		ContainerID:      containerID,
		Origin:           origin,
		Destination:      destination,
		Carrier:          carrier,
		Shipper:          clientOrg,
		CurrentHolder:    clientOrg,
		Status:           StatusCreated,
		CargoType:        cargoType,
		WeightKg:         weightKg,
		CreatedAt:        now,
		EstimatedArrival: estimatedArrival,
		DelayRiskScore:   0.0, // will be updated by ML service
		Events: []ShipmentEvent{
			{
				EventID:     fmt.Sprintf("EVT-%s-1", shipmentID),
				EventType:   "SHIPMENT_CREATED",
				Location:    origin,
				Actor:       clientOrg,
				Timestamp:   now,
				Description: fmt.Sprintf("Shipment created. Container %s ready at %s", containerID, origin),
				TxID:        ctx.GetStub().GetTxID(),
			},
		},
	}

	shipmentJSON, err := json.Marshal(shipment)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal shipment: %v", err)
	}

	err = ctx.GetStub().PutState(shipmentID, shipmentJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to write shipment to ledger: %v", err)
	}

	// Emit event so external apps can listen
	ctx.GetStub().SetEvent("ShipmentCreated", shipmentJSON)

	return &shipment, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// RecordEvent — adds a milestone event to a shipment (e.g. port arrival)
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) RecordEvent(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
	eventType string,
	location string,
	description string,
) (*Shipment, error) {

	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}

	clientOrg, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return nil, fmt.Errorf("failed to get client identity: %v", err)
	}

	newEvent := ShipmentEvent{
		EventID:     fmt.Sprintf("EVT-%s-%d", shipmentID, len(shipment.Events)+1),
		EventType:   eventType,
		Location:    location,
		Actor:       clientOrg,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Description: description,
		TxID:        ctx.GetStub().GetTxID(),
	}

	shipment.Events = append(shipment.Events, newEvent)

	// Auto-update status based on event type
	shipment.Status = s.deriveStatus(eventType, shipment.Status)

	return s.saveShipment(ctx, shipment)
}

// ─────────────────────────────────────────────────────────────────────────────
// TransferCustody — transfers responsibility from one org to another
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) TransferCustody(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
	newHolder string,
	location string,
) (*Shipment, error) {

	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}

	// RBAC Check: Only a carrier can transfer custody
	err = ctx.GetClientIdentity().AssertAttributeValue("role", "carrier")
	if err != nil {
		return nil, fmt.Errorf("access denied: only users with the 'carrier' role can transfer custody")
	}

	clientOrg, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return nil, fmt.Errorf("failed to get client identity: %v", err)
	}

	// Only the current holder can transfer
	if shipment.CurrentHolder != clientOrg {
		return nil, fmt.Errorf("only current holder (%s) can transfer custody, caller is %s",
			shipment.CurrentHolder, clientOrg)
	}

	previousHolder := shipment.CurrentHolder
	shipment.CurrentHolder = newHolder

	transferEvent := ShipmentEvent{
		EventID:     fmt.Sprintf("EVT-%s-%d", shipmentID, len(shipment.Events)+1),
		EventType:   "CUSTODY_TRANSFERRED",
		Location:    location,
		Actor:       clientOrg,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Description: fmt.Sprintf("Custody transferred from %s to %s at %s", previousHolder, newHolder, location),
		TxID:        ctx.GetStub().GetTxID(),
	}
	shipment.Events = append(shipment.Events, transferEvent)

	return s.saveShipment(ctx, shipment)
}

// ─────────────────────────────────────────────────────────────────────────────
// UpdateDelayRisk — called by ML service to store latest risk score on-chain
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) UpdateDelayRisk(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
	riskScore float64,
) (*Shipment, error) {

	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}

	shipment.DelayRiskScore = riskScore

	// If risk is very high, mark as DELAYED
	if riskScore >= 0.85 && shipment.Status == StatusInTransit {
		shipment.Status = StatusDelayed
	}

	return s.saveShipment(ctx, shipment)
}

// ─────────────────────────────────────────────────────────────────────────────
// MarkDelivered — finalises a shipment
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) MarkDelivered(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
) (*Shipment, error) {

	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}

	shipment.Status = StatusDelivered
	shipment.ActualArrival = time.Now().UTC().Format(time.RFC3339)

	clientOrg, _ := ctx.GetClientIdentity().GetMSPID()

	deliveryEvent := ShipmentEvent{
		EventID:     fmt.Sprintf("EVT-%s-%d", shipmentID, len(shipment.Events)+1),
		EventType:   "DELIVERED",
		Location:    shipment.Destination,
		Actor:       clientOrg,
		Timestamp:   shipment.ActualArrival,
		Description: fmt.Sprintf("Shipment delivered to %s", shipment.Destination),
		TxID:        ctx.GetStub().GetTxID(),
	}
	shipment.Events = append(shipment.Events, deliveryEvent)

	return s.saveShipment(ctx, shipment)
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Functions
// ─────────────────────────────────────────────────────────────────────────────

// GetShipment returns a single shipment by ID
func (s *SmartContract) GetShipment(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
) (*Shipment, error) {
	return s.getShipment(ctx, shipmentID)
}

// GetAllShipments returns all shipments on the ledger
func (s *SmartContract) GetAllShipments(ctx contractapi.TransactionContextInterface) ([]*Shipment, error) {
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, fmt.Errorf("failed to get all shipments: %v", err)
	}
	defer resultsIterator.Close()

	var shipments []*Shipment
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		var shipment Shipment
		err = json.Unmarshal(queryResponse.Value, &shipment)
		if err != nil {
			return nil, err
		}
		shipments = append(shipments, &shipment)
	}

	return shipments, nil
}

// GetShipmentHistory returns the full transaction history for a shipment
func (s *SmartContract) GetShipmentHistory(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
) ([]map[string]interface{}, error) {

	historyIterator, err := ctx.GetStub().GetHistoryForKey(shipmentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get history for %s: %v", shipmentID, err)
	}
	defer historyIterator.Close()

	var history []map[string]interface{}
	for historyIterator.HasNext() {
		modification, err := historyIterator.Next()
		if err != nil {
			return nil, err
		}

		entry := map[string]interface{}{
			"txId":      modification.TxId,
			"timestamp": modification.Timestamp,
			"isDelete":  modification.IsDelete,
		}

		if !modification.IsDelete {
			var shipment Shipment
			json.Unmarshal(modification.Value, &shipment)
			entry["value"] = shipment
		}

		history = append(history, entry)
	}

	return history, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) getShipment(ctx contractapi.TransactionContextInterface, shipmentID string) (*Shipment, error) {
	shipmentJSON, err := ctx.GetStub().GetState(shipmentID)
	if err != nil {
		return nil, fmt.Errorf("failed to read shipment %s: %v", shipmentID, err)
	}
	if shipmentJSON == nil {
		return nil, fmt.Errorf("shipment %s does not exist", shipmentID)
	}

	var shipment Shipment
	err = json.Unmarshal(shipmentJSON, &shipment)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal shipment: %v", err)
	}

	return &shipment, nil
}

func (s *SmartContract) saveShipment(ctx contractapi.TransactionContextInterface, shipment *Shipment) (*Shipment, error) {
	shipmentJSON, err := json.Marshal(shipment)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal shipment: %v", err)
	}
	err = ctx.GetStub().PutState(shipment.ShipmentID, shipmentJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to save shipment: %v", err)
	}
	return shipment, nil
}

func (s *SmartContract) deriveStatus(eventType string, current ShipmentStatus) ShipmentStatus {
	switch eventType {
	case "DEPARTED_PORT":
		return StatusInTransit
	case "ARRIVED_PORT":
		return StatusAtPort
	case "CUSTOMS_ENTRY":
		return StatusInCustoms
	case "CUSTOMS_CLEARED":
		return StatusInTransit
	case "DELIVERED":
		return StatusDelivered
	default:
		return current
	}
}


// UpdateStatus — directly sets shipment status (requires MAJORITY endorsement)
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) UpdateStatus(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
	newStatus string,
	reason string,
) (*Shipment, error) {
	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}
	validStatuses := map[string]ShipmentStatus{
		"CREATED": StatusCreated, "IN_TRANSIT": StatusInTransit,
		"AT_PORT": StatusAtPort,  "IN_CUSTOMS": StatusInCustoms,
		"DELIVERED": StatusDelivered, "DELAYED": StatusDelayed,
	}
	status, ok := validStatuses[newStatus]
	if !ok {
		return nil, fmt.Errorf("invalid status '%s'. Valid: CREATED,IN_TRANSIT,AT_PORT,IN_CUSTOMS,DELIVERED,DELAYED", newStatus)
	}
	clientOrg, _ := ctx.GetClientIdentity().GetMSPID()
	oldStatus := string(shipment.Status)
	shipment.Status = status
	shipment.Events = append(shipment.Events, ShipmentEvent{
		EventID:     fmt.Sprintf("EVT-%s-%d", shipmentID, len(shipment.Events)+1),
		EventType:   "STATUS_UPDATED",
		Location:    "N/A",
		Actor:       clientOrg,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Description: fmt.Sprintf("Status changed %s → %s. Reason: %s", oldStatus, newStatus, reason),
		TxID:        ctx.GetStub().GetTxID(),
	})
	return s.saveShipment(ctx, shipment)
}

// ─────────────────────────────────────────────────────────────────────────────
// VerifyIntegrity — immutability demo for dissertation.
// Returns whether supplied JSON matches the on-chain record exactly.
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) VerifyIntegrity(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
	claimedDataJSON string,
) (map[string]interface{}, error) {
	onChainJSON, err := ctx.GetStub().GetState(shipmentID)
	if err != nil || onChainJSON == nil {
		return nil, fmt.Errorf("shipment %s not found", shipmentID)
	}
	isMatch := string(onChainJSON) == claimedDataJSON
	msg := "INTEGRITY VERIFIED — data matches ledger exactly"
	if !isMatch {
		msg = "INTEGRITY FAILED — data has been tampered with or modified"
	}
	return map[string]interface{}{
		"shipmentId":    shipmentID,
		"integrityPass": isMatch,
		"verifiedAt":    time.Now().UTC().Format(time.RFC3339),
		"txId":          ctx.GetStub().GetTxID(),
		"message":       msg,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

func main() {
	chaincode, err := contractapi.NewChaincode(&SmartContract{})
	if err != nil {
		fmt.Printf("Error creating DLN chaincode: %v\n", err)
		return
	}
	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting DLN chaincode: %v\n", err)
	}
}
