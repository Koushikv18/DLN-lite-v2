# DLN-Lite — Architecture, Trust Model and Honest Limitations

## The problem

In international shipping, the shipper, the carrier and customs each keep their own records. When a container is late, damaged or disputed, nobody holds a record that all parties trust, and any single party can quietly alter its own copy. DLN-Lite keeps one shared, append-only custody trail, with the rules about *who may change what* enforced by the ledger itself instead of by each party's goodwill.

## System overview

```mermaid
flowchart LR
    UI[React dashboard<br/>shipper / carrier / customs] -->|REST| API[Node.js / Express API]
    API -->|Fabric Gateway<br/>per-user X.509 identity| CC[(Hyperledger Fabric<br/>Org1, Org2, Orderer<br/>Go chaincode: shipment.go)]
    API --> DB[(MongoDB<br/>users, encrypted identities,<br/>shipment metadata)]
    API -->|features| ML[FastAPI ML service<br/>XGBoost + TreeSHAP]
    ML -->|risk score + reasons| API
    CA[Fabric CA per org] -. issues X.509 identity<br/>with role attribute .-> API
```

| Layer | What it holds | Why it lives there |
|---|---|---|
| Ledger (Fabric) | Shipment state, custody events, delay-risk score | Needs tamper-evidence and multi-party trust |
| MongoDB | Login accounts, AES-256-GCM-encrypted Fabric private keys, notes/documents | Private or bulky data that shouldn't be replicated to every peer |
| ML service | Trained model | Stateless scoring; replaceable without touching the ledger |

## How a request is authorised, end to end

1. A user registers or signs in on the portal. Passwords are hashed with PBKDF2 (SHA-512, 120k iterations); the session token is random, expires after 7 days, and only its SHA-256 hash is stored.
2. On registration the backend enrolls the user with the Fabric CA. The certificate carries a `role` attribute (`shipper`, `carrier` or `customs`), and the private key is stored encrypted (AES-256-GCM).
3. Every `/api/shipments`, `/api/ml`, `/api/analytics` and `/api/chat` request must carry the token (`authenticate` middleware, 401 otherwise). The portal attaches it to every call.
4. The API checks the role first (403 otherwise): only a shipper creates shipments, only a carrier transfers custody, only a carrier or customs delivers or sets status.
5. The route then calls `fabricService` **with that user's email**, which opens a Fabric Gateway connection signed with that user's certificate.
6. The chaincode enforces the same rules independently, using the certificate's `role` attribute. Even a client that bypasses the API cannot get around it. Events record the actor's MSP ID, the Fabric transaction ID and the transaction timestamp.

| Chaincode function | Allowed roles |
|---|---|
| `CreateShipment` | shipper |
| `TransferCustody` | carrier, and the caller's org must be the current holder; new holder must be 1–64 characters and different from the current holder |
| `RecordEvent` | shipper, carrier, customs (a `DELIVERED` event: carrier or customs only) |
| `UpdateDelayRisk` | shipper, carrier, customs; score must be between 0 and 1 |
| `MarkDelivered`, `UpdateStatus` | carrier, customs |
| Queries (`GetShipment`, `GetAllShipments`, `GetShipmentHistory`, `VerifyIntegrity`, `VerifyEventChain`) | any enrolled identity |

## Tamper-evidence: the custody hash chain

The ledger is already append-only, but a copy of a shipment's history that leaves the system (a PDF, a JSON export, a database row) loses that protection. So every custody event is also **sealed with a SHA-256 hash that covers the event's fields and the hash of the event before it**:

```
event[n].hash = SHA-256( eventId | eventType | location | actor | timestamp | description | txId | event[n-1].hash )
```

Each field is length-prefixed (in UTF-8 bytes), so moving a character from one field to the next changes the hash. The first event links to a fixed genesis hash. The last hash (the **head**) is a short fingerprint of the entire custody trail.

| Tampering | What breaks |
|---|---|
| Edit any field of an event | That event's hash no longer matches |
| Edit an event and recompute its hash | The *next* event's link no longer matches |
| Delete or insert a middle event | The following link no longer matches |
| Re-order events | Links no longer match |
| Strip hashes from events | Unsealed event after sealed ones is rejected |

Three independent ways to check, all tested against each other:

1. **Inside the chaincode**: `VerifyEventChain` re-computes the chain from the ledger's own copy.
2. **In the backend**: `GET /api/shipments/:id/audit` re-computes it in Node (`backend/utils/auditChain.js`) and reports whether the two verdicts and head hashes **agree**.
3. **Offline, with no system at all**: `node scripts/verifyExport.js shipment.json` checks an exported record using only the file. Try it now on `docs/sample/` (an intact record and a tampered one).

A shared test vector (including non-ASCII text) pins the Go and Node implementations to the same output, and mutation tests confirm that disabling any check makes the suite fail.

`VerifyIntegrity` compares a claimed record with the on-chain state **field by field** (not byte for byte), so it ignores key order and whitespace, reports exactly which fields differ (for example `weightKg: 12500 → 50`), and lists off-chain extras (such as database notes) as ignored instead of calling them tampering.

**What the chain does and does not prove.** It proves the recorded history has not been *altered*. It does not prove the events were *true* when written (garbage in, garbage out), and it cannot by itself reveal that the **newest** events were deleted, because a shorter chain is still internally consistent. To catch that, record the head hash somewhere outside the system (on the bill of lading, in an email to the consignee, on a QR code): a truncated history then has a different head.

## Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| A party edits its own copy of a record afterwards | State and history are on the ledger; `VerifyIntegrity` exposes mismatches | Only as strong as the endorsement policy and the number of independent orgs |
| A copy of the history is altered after it leaves the system | Hash chain; offline verifier; head-hash fingerprint | Deleting only the newest events is invisible unless the head hash was recorded elsewhere |
| A shipper forges delivery or status | Role checks in both the API and the chaincode; `DELIVERED` events restricted | Role attribute is only as trustworthy as the CA's issuance process |
| An unauthenticated caller reads or writes shipments | `authenticate` middleware on all data routes | Tokens are bearer tokens: anyone holding one acts as that user |
| A client claims a role or user it doesn't have | Role and identity come from the server-side session, never from request headers or bodies | — |
| Backend database leaked | Fabric private keys are encrypted at rest (AES-256-GCM); the server refuses to start in production without `ENCRYPTION_KEY` | Key management is a single environment variable |
| Endorsing peers disagree on a transaction | Chaincode uses the transaction timestamp instead of wall-clock time | — |

## Known limitations and remaining work

Listed deliberately: knowing them and having a plan is stronger than hoping nobody asks.

1. **All users enroll into `Org1MSP`.** The `role` attribute separates shipper, carrier and customs, but the "current holder" check compares organisations, so it cannot tell two carriers apart. A realistic deployment enrolls each organisation into its own MSP.
2. **Custody holder is free text** (1–64 characters), not a checked organisation ID.
3. **The portal falls back to local demo data when the API call fails** ("created locally because live save failed"). That keeps demos running, but it also hides real failures. Before a demo, confirm the portal is in live mode.
4. **Fabric CA admin credentials are the CA defaults** (`admin` / `adminpw`) in `caService.js`. Fine for a local demo; change them for anything shared.
5. **One active session per user, 7-day lifetime, no refresh.** A new sign-in invalidates the previous token. Tokens are opaque random strings, not JWTs.
6. **The hash chain proves integrity, not truthfulness**, and cannot reveal deletion of the newest events unless the head hash was recorded outside the system (see above).
7. **The ML model is trained on synthetic data** (see `docs/ML_EVALUATION.md`). Real validation needs real port/carrier data.
8. **The network is a single-machine demo** (2 orgs + orderer in Docker). It demonstrates the trust model, not geographic distribution or throughput at scale.
9. **The full stack was not run end to end in the review environment.** The chaincode, API and ML service are unit-tested (see below); integration against a live Fabric network should be re-checked on your machine.

## Where each claim is backed by evidence

| Claim | Evidence |
|---|---|
| Chaincode roles, validation and deterministic timestamps | `blockchain/chaincode/shipment/shipment_test.go`: `cd blockchain/chaincode/shipment && GOFLAGS=-mod=vendor go test ./...` |
| Hash chain, tamper detection, Go-Node agreement | `shipment_test.go` and `tests/backend/auditChain.test.js` (shared test vector) |
| Offline verification | `scripts/verifyExport.js`; samples in `docs/sample/` |
| Portal never reports a false pass | `tests/frontend/portalVerify.test.js` |
| API authentication, role gates, identity propagation, audit endpoint | `tests/backend/shipment.test.js` (Fabric mocked) |
| Encryption-key handling | `tests/backend/encryptionKey.test.js` |
| ML pipeline and per-shipment explanations | `tests/ml/`; `docs/ML_EVALUATION.md` (reproduce with `python ml/evaluate_model.py`) |

The older `tests/blockchain/shipment_test.go` needs `shimtest` and `testify`, which are not vendored, and lives outside the chaincode module, so it is not part of the runnable suite.
