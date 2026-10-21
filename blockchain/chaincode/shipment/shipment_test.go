package main

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the access-control rules of the shipment chaincode.
//
// They run with plain `go test` (no Fabric network, no extra dependencies):
//
//	cd blockchain/chaincode/shipment && go test ./...
//
// The ledger and the caller's X.509 identity are replaced by small fakes, so
// each test can say "a caller with role X and MSP Y does Z" and check that the
// contract allows or rejects it.
// ─────────────────────────────────────────────────────────────────────────────

import (
	"crypto/x509"
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// fixedSeconds is the "transaction time" every fake stub reports:
// 2026-01-01T00:00:00Z. Real peers each see the same value for one transaction.
const fixedSeconds = 1767225600

// ── Fakes ────────────────────────────────────────────────────────────────────

// fakeStub is an in-memory ledger. Embedding the interface means any method
// the contract does not call is simply left unimplemented.
type fakeStub struct {
	shim.ChaincodeStubInterface
	state map[string][]byte
	txID  string
}

func (f *fakeStub) GetState(key string) ([]byte, error) { return f.state[key], nil }
func (f *fakeStub) PutState(key string, value []byte) error {
	f.state[key] = value
	return nil
}
func (f *fakeStub) GetTxID() string { return f.txID }
func (f *fakeStub) GetTxTimestamp() (*timestamp.Timestamp, error) {
	return &timestamp.Timestamp{Seconds: fixedSeconds}, nil
}
func (f *fakeStub) SetEvent(name string, payload []byte) error { return nil }

// fakeIdentity stands in for the caller's certificate.
type fakeIdentity struct {
	mspID string
	attrs map[string]string
}

func (f *fakeIdentity) GetID() (string, error)    { return "fake-id", nil }
func (f *fakeIdentity) GetMSPID() (string, error) { return f.mspID, nil }
func (f *fakeIdentity) GetAttributeValue(name string) (string, bool, error) {
	v, ok := f.attrs[name]
	return v, ok, nil
}
func (f *fakeIdentity) AssertAttributeValue(name, value string) error {
	if v, ok := f.attrs[name]; ok && v == value {
		return nil
	}
	return errAttr
}
func (f *fakeIdentity) GetX509Certificate() (*x509.Certificate, error) { return nil, nil }

type attrError struct{}

func (attrError) Error() string { return "attribute mismatch" }

var errAttr = attrError{}

// ── Test helpers ─────────────────────────────────────────────────────────────

func newStub() *fakeStub {
	return &fakeStub{state: map[string][]byte{}, txID: "tx-test"}
}

// as builds a transaction context for a caller with the given role and MSP.
// An empty role means the certificate has no "role" attribute at all.
func as(stub *fakeStub, role, msp string) contractapi.TransactionContextInterface {
	attrs := map[string]string{}
	if role != "" {
		attrs["role"] = role
	}
	ctx := new(contractapi.TransactionContext)
	ctx.SetStub(stub)
	ctx.SetClientIdentity(&fakeIdentity{mspID: msp, attrs: attrs})
	return ctx
}

// seed creates a shipment as a shipper in Org1MSP and returns its ID.
func seed(t *testing.T, stub *fakeStub) string {
	t.Helper()
	sc := &SmartContract{}
	_, err := sc.CreateShipment(as(stub, "shipper", "Org1MSP"),
		"SHP-1", "CONT-1", "Shanghai, CN", "Rotterdam, NL", "TestCarrier", "Electronics", 5000, "2026-02-01")
	if err != nil {
		t.Fatalf("seeding shipment failed: %v", err)
	}
	return "SHP-1"
}

func load(t *testing.T, stub *fakeStub, id string) Shipment {
	t.Helper()
	var s Shipment
	if err := json.Unmarshal(stub.state[id], &s); err != nil {
		t.Fatalf("could not read shipment %s: %v", id, err)
	}
	return s
}

func mustFail(t *testing.T, err error, wantSubstring string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected an error containing %q, got none", wantSubstring)
	}
	if !strings.Contains(err.Error(), wantSubstring) {
		t.Fatalf("expected error containing %q, got %q", wantSubstring, err.Error())
	}
}

// ── CreateShipment ───────────────────────────────────────────────────────────

func TestCreateShipment_OnlyShipperAllowed(t *testing.T) {
	sc := &SmartContract{}
	for _, role := range []string{"carrier", "customs", ""} {
		stub := newStub()
		_, err := sc.CreateShipment(as(stub, role, "Org1MSP"),
			"SHP-X", "C", "A", "B", "Carrier", "Goods", 10, "2026-02-01")
		mustFail(t, err, "access denied")
		if len(stub.state) != 0 {
			t.Fatalf("role %q must not write to the ledger", role)
		}
	}
}

func TestCreateShipment_UsesTransactionTimestamp(t *testing.T) {
	stub := newStub()
	id := seed(t, stub)
	s := load(t, stub, id)
	if s.CreatedAt != "2026-01-01T00:00:00Z" {
		t.Fatalf("CreatedAt should be the transaction time, got %s", s.CreatedAt)
	}
	if s.Events[0].Timestamp != s.CreatedAt {
		t.Fatalf("event timestamp %s should equal CreatedAt %s", s.Events[0].Timestamp, s.CreatedAt)
	}
}

// ── RecordEvent ──────────────────────────────────────────────────────────────

func TestRecordEvent_RequiresAKnownRole(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)

	for _, role := range []string{"", "intruder", "admin"} {
		_, err := sc.RecordEvent(as(stub, role, "Org1MSP"), id, "DEPARTED_PORT", "Shanghai", "left port")
		mustFail(t, err, "access denied")
	}
	if got := len(load(t, stub, id).Events); got != 1 {
		t.Fatalf("rejected callers must not append events, found %d events", got)
	}

	for _, role := range []string{"shipper", "carrier", "customs"} {
		if _, err := sc.RecordEvent(as(stub, role, "Org1MSP"), id, "NOTE", "Shanghai", "ok"); err != nil {
			t.Fatalf("role %s should be able to record events: %v", role, err)
		}
	}
}

func TestRecordEvent_ShipperCannotForgeDelivery(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)

	_, err := sc.RecordEvent(as(stub, "shipper", "Org1MSP"), id, "DELIVERED", "Rotterdam", "forged")
	mustFail(t, err, "DELIVERED")
	if load(t, stub, id).Status == StatusDelivered {
		t.Fatal("a shipper must not be able to mark a shipment delivered through RecordEvent")
	}

	if _, err := sc.RecordEvent(as(stub, "carrier", "Org1MSP"), id, "DELIVERED", "Rotterdam", "handed over"); err != nil {
		t.Fatalf("a carrier may record DELIVERED: %v", err)
	}
}

func TestRecordEvent_UsesTransactionTimestamp(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)
	s, err := sc.RecordEvent(as(stub, "carrier", "Org1MSP"), id, "DEPARTED_PORT", "Shanghai", "left port")
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Events[len(s.Events)-1].Timestamp; got != "2026-01-01T00:00:00Z" {
		t.Fatalf("event should carry the transaction time, got %s", got)
	}
}

// ── TransferCustody ──────────────────────────────────────────────────────────

func TestTransferCustody_OnlyCarrier(t *testing.T) {
	sc := &SmartContract{}
	for _, role := range []string{"shipper", "customs", ""} {
		stub := newStub()
		id := seed(t, stub)
		_, err := sc.TransferCustody(as(stub, role, "Org1MSP"), id, "Org2MSP", "Shanghai")
		mustFail(t, err, "carrier")
		if load(t, stub, id).CurrentHolder != "Org1MSP" {
			t.Fatalf("role %q must not change the holder", role)
		}
	}
}

func TestTransferCustody_CarrierHoldingTheCargoCanTransfer(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)

	s, err := sc.TransferCustody(as(stub, "carrier", "Org1MSP"), id, "Org2MSP", "Shanghai")
	if err != nil {
		t.Fatalf("carrier in the holding org should transfer: %v", err)
	}
	if s.CurrentHolder != "Org2MSP" {
		t.Fatalf("holder should be Org2MSP, got %s", s.CurrentHolder)
	}
}

func TestTransferCustody_CarrierFromAnotherOrgCannotTransfer(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)

	_, err := sc.TransferCustody(as(stub, "carrier", "Org2MSP"), id, "Org2MSP", "Shanghai")
	mustFail(t, err, "only current holder")
}

func TestTransferCustody_RejectsBadNewHolder(t *testing.T) {
	sc := &SmartContract{}
	cases := map[string]string{
		"empty":        "",
		"whitespace":   "   ",
		"too long":     strings.Repeat("x", 65),
		"already held": "Org1MSP",
	}
	for name, holder := range cases {
		stub := newStub()
		id := seed(t, stub)
		_, err := sc.TransferCustody(as(stub, "carrier", "Org1MSP"), id, holder, "Shanghai")
		if err == nil {
			t.Fatalf("%s: expected the transfer to be rejected", name)
		}
		if load(t, stub, id).CurrentHolder != "Org1MSP" {
			t.Fatalf("%s: holder must be unchanged", name)
		}
	}
}

// ── UpdateDelayRisk ──────────────────────────────────────────────────────────

func TestUpdateDelayRisk_RequiresKnownRole(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)

	_, err := sc.UpdateDelayRisk(as(stub, "", "Org1MSP"), id, 0.2)
	mustFail(t, err, "access denied")
	_, err = sc.UpdateDelayRisk(as(stub, "intruder", "Org1MSP"), id, 0.2)
	mustFail(t, err, "access denied")
	if load(t, stub, id).DelayRiskScore != 0 {
		t.Fatal("rejected callers must not change the risk score")
	}

	for _, role := range []string{"shipper", "carrier", "customs"} {
		if _, err := sc.UpdateDelayRisk(as(stub, role, "Org1MSP"), id, 0.3); err != nil {
			t.Fatalf("role %s should be able to update risk: %v", role, err)
		}
	}
}

func TestUpdateDelayRisk_RejectsOutOfRangeScores(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)

	for _, bad := range []float64{-0.1, 1.5, math.NaN(), math.Inf(1)} {
		_, err := sc.UpdateDelayRisk(as(stub, "carrier", "Org1MSP"), id, bad)
		mustFail(t, err, "between 0 and 1")
	}
	if _, err := sc.UpdateDelayRisk(as(stub, "carrier", "Org1MSP"), id, 0); err != nil {
		t.Fatalf("0 is a valid score: %v", err)
	}
	if _, err := sc.UpdateDelayRisk(as(stub, "carrier", "Org1MSP"), id, 1); err != nil {
		t.Fatalf("1 is a valid score: %v", err)
	}
}

// ── MarkDelivered ────────────────────────────────────────────────────────────

func TestMarkDelivered_ShipperCannot_CarrierAndCustomsCan(t *testing.T) {
	sc := &SmartContract{}

	for _, role := range []string{"shipper", "", "intruder"} {
		stub := newStub()
		id := seed(t, stub)
		_, err := sc.MarkDelivered(as(stub, role, "Org1MSP"), id)
		mustFail(t, err, "access denied")
		if load(t, stub, id).Status == StatusDelivered {
			t.Fatalf("role %q must not be able to deliver", role)
		}
	}

	for _, role := range []string{"carrier", "customs"} {
		stub := newStub()
		id := seed(t, stub)
		s, err := sc.MarkDelivered(as(stub, role, "Org1MSP"), id)
		if err != nil {
			t.Fatalf("role %s should be able to deliver: %v", role, err)
		}
		if s.Status != StatusDelivered {
			t.Fatalf("status should be DELIVERED, got %s", s.Status)
		}
		if s.ActualArrival != "2026-01-01T00:00:00Z" {
			t.Fatalf("ActualArrival should be the transaction time, got %s", s.ActualArrival)
		}
	}
}

// ── UpdateStatus ─────────────────────────────────────────────────────────────

func TestUpdateStatus_ShipperCannotOverwriteStatus(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)

	_, err := sc.UpdateStatus(as(stub, "shipper", "Org1MSP"), id, "DELIVERED", "forged")
	mustFail(t, err, "access denied")
	if load(t, stub, id).Status != StatusCreated {
		t.Fatal("status must be unchanged after a rejected update")
	}

	s, err := sc.UpdateStatus(as(stub, "customs", "Org1MSP"), id, "IN_CUSTOMS", "inspection")
	if err != nil {
		t.Fatalf("customs should be able to update status: %v", err)
	}
	if s.Status != StatusInCustoms {
		t.Fatalf("expected IN_CUSTOMS, got %s", s.Status)
	}
	if got := s.Events[len(s.Events)-1].Timestamp; got != "2026-01-01T00:00:00Z" {
		t.Fatalf("status event should carry the transaction time, got %s", got)
	}
}

func TestUpdateStatus_RejectsUnknownStatus(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)
	_, err := sc.UpdateStatus(as(stub, "carrier", "Org1MSP"), id, "TELEPORTED", "no")
	mustFail(t, err, "invalid status")
}
