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
| Queries (`GetShipment`, `GetAllShipments`, `GetShipmentHistory`, `VerifyIntegrity`) | any enrolled identity |

`VerifyIntegrity` compares a claimed record byte-for-byte with the on-chain state, which is what makes the "someone edited the database copy" demo possible.

## Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| A party edits its own copy of a record afterwards | State and history are on the ledger; `VerifyIntegrity` exposes mismatches | Only as strong as the endorsement policy and the number of independent orgs |
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
6. **`VerifyIntegrity` compares raw JSON strings**, which is sensitive to key order. Comparing a SHA-256 of a canonical form would be sturdier.
7. **The ML model is trained on synthetic data** (see `docs/ML_EVALUATION.md`). Real validation needs real port/carrier data.
8. **The network is a single-machine demo** (2 orgs + orderer in Docker). It demonstrates the trust model, not geographic distribution or throughput at scale.
9. **The full stack was not run end to end in the review environment.** The chaincode, API and ML service are unit-tested (see below); integration against a live Fabric network should be re-checked on your machine.

## Where each claim is backed by evidence

| Claim | Evidence |
|---|---|
| Chaincode roles, validation and deterministic timestamps | `blockchain/chaincode/shipment/shipment_test.go`: `cd blockchain/chaincode/shipment && GOFLAGS=-mod=vendor go test ./...` |
| API authentication, role gates and identity propagation | `tests/backend/shipment.test.js` (Fabric mocked) |
| Encryption-key handling | `tests/backend/encryptionKey.test.js` |
| ML pipeline and per-shipment explanations | `tests/ml/`; `docs/ML_EVALUATION.md` (reproduce with `python ml/evaluate_model.py`) |

The older `tests/blockchain/shipment_test.go` needs `shimtest` and `testify`, which are not vendored, and lives outside the chaincode module, so it is not part of the runnable suite.
