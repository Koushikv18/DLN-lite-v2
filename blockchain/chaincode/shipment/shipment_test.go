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

// ── Hash chain ───────────────────────────────────────────────────────────────

// Computed independently by backend/utils/auditChain.js (Node). If this test and
// the Node test both pass, the two implementations produce identical hashes.
const crossLanguageVector = "8a9e8d4a860d6e5c013150855e4ba464774fa5345863e479e2dea2f85680547b"

func TestEventHash_MatchesNodeImplementation(t *testing.T) {
	e := ShipmentEvent{
		EventID:     "EVT-SHP-1-1",
		EventType:   "SHIPMENT_CREATED",
		Location:    "Rotterdam, NL — Café", // non-ASCII: byte length must be used, not rune count
		Actor:       "Org1MSP",
		Timestamp:   "2026-01-01T00:00:00Z",
		Description: "Shipment created. Container CONT-1 ready",
		TxID:        "tx-test",
		PrevHash:    genesisHash,
	}
	if got := eventHash(e); got != crossLanguageVector {
		t.Fatalf("hash differs from the Node implementation:\n go   %s\n node %s", got, crossLanguageVector)
	}
}

func TestEventHash_FieldBoundariesAreUnambiguous(t *testing.T) {
	a := eventHash(ShipmentEvent{EventID: "ab", EventType: "c"})
	b := eventHash(ShipmentEvent{EventID: "a", EventType: "bc"})
	if a == b {
		t.Fatal("moving a character between fields must change the hash")
	}
}

func TestChain_EventsAreSealedAndLinked(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)
	if _, err := sc.RecordEvent(as(stub, "carrier", "Org1MSP"), id, "DEPARTED_PORT", "Shanghai", "left port"); err != nil {
		t.Fatal(err)
	}
	if _, err := sc.TransferCustody(as(stub, "carrier", "Org1MSP"), id, "Org2MSP", "Shanghai"); err != nil {
		t.Fatal(err)
	}

	s := load(t, stub, id)
	if len(s.Events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(s.Events))
	}
	if s.Events[0].PrevHash != genesisHash {
		t.Fatal("first event must link to the genesis hash")
	}
	for i, e := range s.Events {
		if e.Hash == "" || e.Hash != eventHash(e) {
			t.Fatalf("event %d is not correctly sealed", i)
		}
		if i > 0 && e.PrevHash != s.Events[i-1].Hash {
			t.Fatalf("event %d does not link to event %d", i, i-1)
		}
	}
	if report := verifyChain(s.Events); !report.Intact || report.HashedEvents != 3 || report.HeadHash != s.Events[2].Hash {
		t.Fatalf("a freshly built chain must verify: %+v", report)
	}
}

func TestInitLedger_SampleDataIsSealed(t *testing.T) {
	sc := &SmartContract{}
	stub := newStub()
	if err := sc.InitLedger(as(stub, "shipper", "Org1MSP")); err != nil {
		t.Fatal(err)
	}
	s := load(t, stub, "SHP-001")
	if report := verifyChain(s.Events); !report.Intact || report.HashedEvents != len(s.Events) || report.LegacyEvents != 0 {
		t.Fatalf("sample shipment chain should be fully sealed and intact: %+v", report)
	}
}

// builtChain returns a shipment with 4 sealed events.
func builtChain(t *testing.T) (*fakeStub, string, Shipment) {
	t.Helper()
	sc := &SmartContract{}
	stub := newStub()
	id := seed(t, stub)
	carrier := as(stub, "carrier", "Org1MSP")
	for _, step := range []struct{ typ, loc string }{{"DEPARTED_PORT", "Shanghai"}, {"CHECKPOINT_1", "Suez"}, {"ARRIVED_PORT", "Rotterdam"}} {
		if _, err := sc.RecordEvent(carrier, id, step.typ, step.loc, "ok"); err != nil {
			t.Fatal(err)
		}
	}
	return stub, id, load(t, stub, id)
}

func TestChain_DetectsEveryKindOfTampering(t *testing.T) {
	_, _, original := builtChain(t)
	clone := func() []ShipmentEvent {
		out := make([]ShipmentEvent, len(original.Events))
		copy(out, original.Events)
		return out
	}

	cases := []struct {
		name   string
		mutate func([]ShipmentEvent) []ShipmentEvent
		at     int
	}{
		{"edited description", func(e []ShipmentEvent) []ShipmentEvent { e[1].Description = "forged"; return e }, 1},
		{"edited location", func(e []ShipmentEvent) []ShipmentEvent { e[2].Location = "Singapore"; return e }, 2},
		{"edited actor", func(e []ShipmentEvent) []ShipmentEvent { e[1].Actor = "EvilOrgMSP"; return e }, 1},
		{"deleted middle event", func(e []ShipmentEvent) []ShipmentEvent { return append(e[:1], e[2:]...) }, 1},
		{"re-ordered events", func(e []ShipmentEvent) []ShipmentEvent { e[1], e[2] = e[2], e[1]; return e }, 1},
		{"stripped hash", func(e []ShipmentEvent) []ShipmentEvent { e[2].Hash = ""; return e }, 2},
		{"forged link", func(e []ShipmentEvent) []ShipmentEvent { e[2].PrevHash = genesisHash; return e }, 2},
	}
	for _, tc := range cases {
		report := verifyChain(tc.mutate(clone()))
		if report.Intact {
			t.Fatalf("%s: tampering was NOT detected", tc.name)
		}
		if report.BrokenAtIndex != tc.at {
			t.Fatalf("%s: expected the break at event %d, reported %d (%s)", tc.name, tc.at, report.BrokenAtIndex, report.Reason)
		}
	}
}

func TestChain_EditingAndRehashingOneEventStillBreaksTheNext(t *testing.T) {
	// A smart forger edits event 1 AND recomputes its hash. Event 2 still points
	// at the old hash, so the chain breaks there.
	_, _, original := builtChain(t)
	events := make([]ShipmentEvent, len(original.Events))
	copy(events, original.Events)
	events[1].Description = "forged"
	events[1].Hash = eventHash(events[1])

	report := verifyChain(events)
	if report.Intact || report.BrokenAtIndex != 2 {
		t.Fatalf("expected the break at event 2, got %+v", report)
	}
}

func TestChain_LegacyEventsAllowedOnlyAtTheStart(t *testing.T) {
	_, _, original := builtChain(t)

	legacyThenSealed := make([]ShipmentEvent, len(original.Events))
	copy(legacyThenSealed, original.Events)
	// Treat the first event as written before sealing existed, then re-link.
	legacyThenSealed[0].Hash, legacyThenSealed[0].PrevHash = "", ""
	legacyThenSealed[1].PrevHash = genesisHash
	legacyThenSealed[1].Hash = eventHash(legacyThenSealed[1])
	prev := legacyThenSealed[1].Hash
	for i := 2; i < len(legacyThenSealed); i++ {
		legacyThenSealed[i].PrevHash = prev
		legacyThenSealed[i].Hash = eventHash(legacyThenSealed[i])
		prev = legacyThenSealed[i].Hash
	}
	report := verifyChain(legacyThenSealed)
	if !report.Intact || report.LegacyEvents != 1 {
		t.Fatalf("legacy events at the start must be tolerated: %+v", report)
	}
}

func TestVerifyEventChain_ReadsTheLedgerAndCatchesATamperedRecord(t *testing.T) {
	sc := &SmartContract{}
	stub, id, _ := builtChain(t)
	ctx := as(stub, "customs", "Org1MSP")

	ok, err := sc.VerifyEventChain(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if ok["intact"] != true || ok["eventCount"] != 4 {
		t.Fatalf("untouched ledger record should verify: %v", ok)
	}

	// Someone edits the stored record directly (as a database admin would).
	s := load(t, stub, id)
	s.Events[1].Description = "forged"
	raw, _ := json.Marshal(s)
	stub.state[id] = raw

	bad, err := sc.VerifyEventChain(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if bad["intact"] != false || bad["brokenAtIndex"] != 1 {
		t.Fatalf("tampered record must be flagged at event 1: %v", bad)
	}
}

// ── VerifyIntegrity (structural comparison) ──────────────────────────────────

func TestVerifyIntegrity_IdenticalAndReorderedKeysPass(t *testing.T) {
	sc := &SmartContract{}
	stub, id, _ := builtChain(t)
	ctx := as(stub, "customs", "Org1MSP")

	res, err := sc.VerifyIntegrity(ctx, id, string(stub.state[id]))
	if err != nil || res["integrityPass"] != true {
		t.Fatalf("identical copy must pass: %v %v", res, err)
	}

	// Same data, different key order and whitespace: still the same record.
	var generic map[string]interface{}
	_ = json.Unmarshal(stub.state[id], &generic)
	pretty, _ := json.MarshalIndent(generic, "", "   ") // Go sorts map keys alphabetically
	res, err = sc.VerifyIntegrity(ctx, id, string(pretty))
	if err != nil || res["integrityPass"] != true {
		t.Fatalf("key order / whitespace must not cause a false alarm: %v %v", res, err)
	}
}

func TestVerifyIntegrity_ReportsExactlyWhichFieldsWereChanged(t *testing.T) {
	sc := &SmartContract{}
	stub, id, _ := builtChain(t)
	ctx := as(stub, "customs", "Org1MSP")

	var generic map[string]interface{}
	_ = json.Unmarshal(stub.state[id], &generic)
	generic["weightKg"] = 50.0
	generic["events"].([]interface{})[1].(map[string]interface{})["description"] = "forged"
	tampered, _ := json.Marshal(generic)

	res, err := sc.VerifyIntegrity(ctx, id, string(tampered))
	if err != nil {
		t.Fatal(err)
	}
	if res["integrityPass"] != false {
		t.Fatal("tampering must be detected")
	}
	paths := map[string]bool{}
	for _, d := range res["differences"].([]fieldDiff) {
		paths[d.Path] = true
	}
	if !paths["weightKg"] || !paths["events[1].description"] || len(paths) != 2 {
		t.Fatalf("expected exactly weightKg and events[1].description, got %v", paths)
	}
}

func TestVerifyIntegrity_ExtraClaimedFieldsAreIgnoredNotFlagged(t *testing.T) {
	sc := &SmartContract{}
	stub, id, _ := builtChain(t)
	ctx := as(stub, "customs", "Org1MSP")

	var generic map[string]interface{}
	_ = json.Unmarshal(stub.state[id], &generic)
	generic["notes"] = "off-chain note from the database"
	withExtra, _ := json.Marshal(generic)

	res, err := sc.VerifyIntegrity(ctx, id, string(withExtra))
	if err != nil || res["integrityPass"] != true {
		t.Fatalf("off-chain extras are not tampering: %v %v", res, err)
	}
	ignored := res["ignoredFields"].([]string)
	if len(ignored) != 1 || ignored[0] != "notes" {
		t.Fatalf("extra field should be listed as ignored: %v", ignored)
	}
}

func TestVerifyIntegrity_RejectsInvalidJSON(t *testing.T) {
	sc := &SmartContract{}
	stub, id, _ := builtChain(t)
	_, err := sc.VerifyIntegrity(as(stub, "customs", "Org1MSP"), id, "{not json")
	mustFail(t, err, "not valid JSON")
}
