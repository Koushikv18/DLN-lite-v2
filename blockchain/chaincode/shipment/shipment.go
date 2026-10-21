package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
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
	PrevHash    string `json:"prevHash,omitempty"` // hash of the previous event (genesis hash for the first)
	Hash        string `json:"hash,omitempty"`     // SHA-256 seal over this event and PrevHash
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: access control and deterministic time
// ─────────────────────────────────────────────────────────────────────────────

// Roles issued by the Fabric CA (certificate attribute "role").
const (
	roleShipper = "shipper"
	roleCarrier = "carrier"
	roleCustoms = "customs"
)

// requireRole makes sure the caller's certificate carries one of the allowed
// roles. A caller with no "role" attribute at all is always rejected.
func requireRole(ctx contractapi.TransactionContextInterface, action string, allowed ...string) error {
	role, found, err := ctx.GetClientIdentity().GetAttributeValue("role")
	if err != nil {
		return fmt.Errorf("failed to read caller role: %v", err)
	}
	if !found {
		return fmt.Errorf("access denied: caller has no 'role' attribute and cannot %s", action)
	}
	for _, r := range allowed {
		if role == r {
			return nil
		}
	}
	return fmt.Errorf("access denied: role '%s' cannot %s (allowed: %s)", role, action, strings.Join(allowed, ", "))
}

// txTimestamp returns the transaction's own timestamp. Unlike time.Now() it is
// identical on every endorsing peer, so all endorsements produce the same
// read/write set and the transaction can be committed.
func txTimestamp(ctx contractapi.TransactionContextInterface) (string, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return "", fmt.Errorf("failed to read transaction timestamp: %v", err)
	}
	return time.Unix(ts.Seconds, int64(ts.Nanos)).UTC().Format(time.RFC3339), nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Event hash chain
//
// Every custody event is sealed with a SHA-256 hash that covers the event's own
// fields AND the hash of the event before it. Editing, deleting, inserting or
// re-ordering any event breaks every hash after it. The last hash (the "head")
// is a short fingerprint of the entire custody trail, and anyone holding an
// exported copy of the history can re-check it offline with no access to the
// ledger (see backend/utils/auditChain.js, which computes the identical hash).
// ─────────────────────────────────────────────────────────────────────────────

// genesisHash is the PrevHash of the first sealed event in a shipment.
const genesisHash = "0000000000000000000000000000000000000000000000000000000000000000"

// eventHash hashes the event's fields in a fixed order. Every field is
// length-prefixed (byte length) so that ("ab","c") and ("a","bc") differ.
func eventHash(e ShipmentEvent) string {
	h := sha256.New()
	for _, field := range []string{e.EventID, e.EventType, e.Location, e.Actor, e.Timestamp, e.Description, e.TxID, e.PrevHash} {
		fmt.Fprintf(h, "%d:%s|", len(field), field)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// chainHead returns the hash of the last sealed event, or the genesis hash.
func chainHead(events []ShipmentEvent) string {
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Hash != "" {
			return events[i].Hash
		}
	}
	return genesisHash
}

// sealEvent links an event to the end of the shipment's chain and appends it.
func sealEvent(shipment *Shipment, e ShipmentEvent) {
	e.PrevHash = chainHead(shipment.Events)
	e.Hash = eventHash(e)
	shipment.Events = append(shipment.Events, e)
}

// resealEvents rebuilds the chain over the events a shipment starts with.
func resealEvents(shipment *Shipment) {
	events := shipment.Events
	shipment.Events = nil
	for _, e := range events {
		e.PrevHash, e.Hash = "", ""
		sealEvent(shipment, e)
	}
}

// ChainReport is the outcome of checking a shipment's hash chain.
type ChainReport struct {
	Intact        bool
	EventCount    int
	HashedEvents  int
	LegacyEvents  int
	HeadHash      string
	BrokenAtIndex int // -1 when the chain is intact
	Reason        string
}

// verifyChain walks the events and re-computes every hash. Events written
// before sealing existed (no hash) are tolerated only at the very start.
func verifyChain(events []ShipmentEvent) ChainReport {
	report := ChainReport{Intact: true, EventCount: len(events), HeadHash: genesisHash, BrokenAtIndex: -1}
	prev := genesisHash
	sealedSeen := false

	fail := func(i int, reason string) ChainReport {
		report.Intact = false
		report.BrokenAtIndex = i
		report.Reason = reason
		return report
	}

	for i, e := range events {
		if e.Hash == "" {
			if sealedSeen {
				return fail(i, fmt.Sprintf("event %d has no hash but follows sealed events (hash stripped)", i))
			}
			report.LegacyEvents++
			continue
		}
		sealedSeen = true
		if e.PrevHash != prev {
			return fail(i, fmt.Sprintf("event %d does not link to the previous event (an event was removed, inserted or re-ordered)", i))
		}
		if eventHash(e) != e.Hash {
			return fail(i, fmt.Sprintf("event %d content does not match its hash (event was edited)", i))
		}
		report.HashedEvents++
		prev = e.Hash
		report.HeadHash = e.Hash
	}
	return report
}

// FieldDiff describes one difference between the claimed and on-chain record.
type fieldDiff struct {
	Path    string      `json:"path"`
	OnChain interface{} `json:"onChain"`
	Claimed interface{} `json:"claimed"`
}

// diffJSON compares decoded JSON values. Fields that exist only in the claimed
// copy are not on the ledger, so they are reported as ignored, not as tampering.
func diffJSON(path string, onChain, claimed interface{}, diffs *[]fieldDiff, ignored *[]string) {
	switch a := onChain.(type) {
	case map[string]interface{}:
		b, ok := claimed.(map[string]interface{})
		if !ok {
			*diffs = append(*diffs, fieldDiff{path, onChain, claimed})
			return
		}
		keys := make([]string, 0, len(a))
		for k := range a {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			child := k
			if path != "" {
				child = path + "." + k
			}
			bv, present := b[k]
			if !present {
				*diffs = append(*diffs, fieldDiff{child, a[k], nil})
				continue
			}
			diffJSON(child, a[k], bv, diffs, ignored)
		}
		for k := range b {
			if _, onLedger := a[k]; !onLedger {
				child := k
				if path != "" {
					child = path + "." + k
				}
				*ignored = append(*ignored, child)
			}
		}
	case []interface{}:
		b, ok := claimed.([]interface{})
		if !ok {
			*diffs = append(*diffs, fieldDiff{path, onChain, claimed})
			return
		}
		if len(a) != len(b) {
			*diffs = append(*diffs, fieldDiff{path + ".length", len(a), len(b)})
		}
		for i := 0; i < len(a) && i < len(b); i++ {
			diffJSON(fmt.Sprintf("%s[%d]", path, i), a[i], b[i], diffs, ignored)
		}
	default:
		if !reflect.DeepEqual(onChain, claimed) {
			*diffs = append(*diffs, fieldDiff{path, onChain, claimed})
		}
	}
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
		resealEvents(&shipment)
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

	now, err := txTimestamp(ctx)
	if err != nil {
		return nil, err
	}

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
	resealEvents(&shipment) // seal the first event into the hash chain

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

	if err := requireRole(ctx, "record events", roleShipper, roleCarrier, roleCustoms); err != nil {
		return nil, err
	}
	// Only carriers and customs can attest that cargo was delivered.
	if eventType == "DELIVERED" {
		if err := requireRole(ctx, "record a DELIVERED event", roleCarrier, roleCustoms); err != nil {
			return nil, err
		}
	}

	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}

	clientOrg, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return nil, fmt.Errorf("failed to get client identity: %v", err)
	}

	eventTime, err := txTimestamp(ctx)
	if err != nil {
		return nil, err
	}

	newEvent := ShipmentEvent{
		EventID:     fmt.Sprintf("EVT-%s-%d", shipmentID, len(shipment.Events)+1),
		EventType:   eventType,
		Location:    location,
		Actor:       clientOrg,
		Timestamp:   eventTime,
		Description: description,
		TxID:        ctx.GetStub().GetTxID(),
	}

	sealEvent(shipment, newEvent)

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

	// RBAC Check: Only a carrier can transfer custody
	if err := requireRole(ctx, "transfer custody", roleCarrier); err != nil {
		return nil, fmt.Errorf("access denied: only users with the 'carrier' role can transfer custody")
	}

	newHolder = strings.TrimSpace(newHolder)
	if newHolder == "" || len(newHolder) > 64 {
		return nil, fmt.Errorf("invalid new holder: must be 1-64 characters")
	}

	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}
	if newHolder == shipment.CurrentHolder {
		return nil, fmt.Errorf("invalid new holder: %s already holds this shipment", newHolder)
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

	transferTime, err := txTimestamp(ctx)
	if err != nil {
		return nil, err
	}

	previousHolder := shipment.CurrentHolder
	shipment.CurrentHolder = newHolder

	transferEvent := ShipmentEvent{
		EventID:     fmt.Sprintf("EVT-%s-%d", shipmentID, len(shipment.Events)+1),
		EventType:   "CUSTODY_TRANSFERRED",
		Location:    location,
		Actor:       clientOrg,
		Timestamp:   transferTime,
		Description: fmt.Sprintf("Custody transferred from %s to %s at %s", previousHolder, newHolder, location),
		TxID:        ctx.GetStub().GetTxID(),
	}
	sealEvent(shipment, transferEvent)

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

	if err := requireRole(ctx, "update delay risk", roleShipper, roleCarrier, roleCustoms); err != nil {
		return nil, err
	}
	if math.IsNaN(riskScore) || riskScore < 0 || riskScore > 1 {
		return nil, fmt.Errorf("invalid risk score %v: must be between 0 and 1", riskScore)
	}

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

	if err := requireRole(ctx, "mark a shipment delivered", roleCarrier, roleCustoms); err != nil {
		return nil, err
	}

	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}

	deliveredAt, err := txTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	shipment.Status = StatusDelivered
	shipment.ActualArrival = deliveredAt

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
	sealEvent(shipment, deliveryEvent)

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
	if err := requireRole(ctx, "update shipment status", roleCarrier, roleCustoms); err != nil {
		return nil, err
	}
	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}
	statusTime, err := txTimestamp(ctx)
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
	sealEvent(shipment, ShipmentEvent{
		EventID:     fmt.Sprintf("EVT-%s-%d", shipmentID, len(shipment.Events)+1),
		EventType:   "STATUS_UPDATED",
		Location:    "N/A",
		Actor:       clientOrg,
		Timestamp:   statusTime,
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

	// Compare the decoded values, not the raw bytes: a copy that differs only in
	// key order or whitespace is the same record; a changed value is not.
	var onChain, claimed interface{}
	if err := json.Unmarshal(onChainJSON, &onChain); err != nil {
		return nil, fmt.Errorf("on-chain record is not valid JSON: %v", err)
	}
	if err := json.Unmarshal([]byte(claimedDataJSON), &claimed); err != nil {
		return nil, fmt.Errorf("claimed data is not valid JSON: %v", err)
	}

	diffs := []fieldDiff{}
	ignored := []string{}
	diffJSON("", onChain, claimed, &diffs, &ignored)
	sort.Strings(ignored)

	isMatch := len(diffs) == 0
	msg := "INTEGRITY VERIFIED — data matches ledger exactly"
	if !isMatch {
		msg = fmt.Sprintf("INTEGRITY FAILED — %d field(s) differ from the ledger", len(diffs))
	}
	fingerprint := sha256.Sum256(onChainJSON)
	return map[string]interface{}{
		"shipmentId":        shipmentID,
		"integrityPass":     isMatch,
		"differences":       diffs,
		"ignoredFields":     ignored,
		"ledgerFingerprint": hex.EncodeToString(fingerprint[:]),
		"verifiedAt":        time.Now().UTC().Format(time.RFC3339),
		"txId":              ctx.GetStub().GetTxID(),
		"message":           msg,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// VerifyEventChain — re-computes the hash chain over a shipment's events and
// reports whether the custody trail is intact, with its head-hash fingerprint.
// ─────────────────────────────────────────────────────────────────────────────

func (s *SmartContract) VerifyEventChain(
	ctx contractapi.TransactionContextInterface,
	shipmentID string,
) (map[string]interface{}, error) {
	shipment, err := s.getShipment(ctx, shipmentID)
	if err != nil {
		return nil, err
	}
	report := verifyChain(shipment.Events)
	return map[string]interface{}{
		"shipmentId":    shipmentID,
		"intact":        report.Intact,
		"eventCount":    report.EventCount,
		"hashedEvents":  report.HashedEvents,
		"legacyEvents":  report.LegacyEvents,
		"headHash":      report.HeadHash,
		"brokenAtIndex": report.BrokenAtIndex,
		"reason":        report.Reason,
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
