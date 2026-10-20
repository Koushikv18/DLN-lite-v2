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

## How a custody transfer is meant to be authorised

1. A user registers; the backend enrolls them with their organisation's Fabric CA. The certificate carries a `role` attribute (`shipper`, `carrier`, ...). Passwords are hashed with PBKDF2 (SHA-512, 120k iterations); session tokens are random and stored only as SHA-256 hashes.
2. The backend stores the Fabric private key encrypted (AES-256-GCM) in MongoDB. `fabricService` is built to open a Gateway connection *as that user*.
3. The chaincode (`TransferCustody`) checks, inside the transaction:
   - the caller's certificate has `role = carrier`, **and**
   - the caller's organisation (MSP) is the shipment's current holder.
4. The event is appended with the actor's MSP ID, the Fabric transaction ID and a timestamp, and the whole history is queryable via `GetShipmentHistory`.

`VerifyIntegrity` compares a claimed record byte-for-byte with the on-chain state, which is what makes the "someone edited the database copy" demo possible.

## Known limitations and hardening backlog

Listed deliberately: knowing them and having a plan is stronger than hoping nobody asks. Items 1–3 were found by reading the code, **not by running the full stack**, so confirm them against your running network.

1. **The REST routes do not pass a user identity to `fabricService`.** Every `fabricService` method takes `userId` as its first argument (e.g. `createShipment(userId, data)`), but `shipmentRoutes.js` calls them without it (e.g. `createShipment(shipmentData)`), no middleware turns the bearer token into `req.user`, and the frontend does not send an `Authorization` header. The backend tests pass because they mock `fabricService`. The fix is a small `requireAuth` middleware plus passing `req.user.email` through, with tests asserting the identity reaches `fabricService`.
2. **Only two chaincode write functions enforce roles.** `CreateShipment` (shipper) and `TransferCustody` (carrier + current holder) do. `RecordEvent`, `UpdateDelayRisk` and `MarkDelivered` accept any enrolled identity, so any user could mark any shipment delivered or overwrite its risk score. Next step: require the current holder (or a customs role) for `MarkDelivered`, and a dedicated `oracle` role for `UpdateDelayRisk`.
3. **Encryption key falls back to a hard-coded default.** `caService.js` uses `ENCRYPTION_KEY` from the environment but, if unset, derives a key from the string `default-dev-key`. Anyone who reads the repo could decrypt stored identities on a deployment that forgot to set it. It should refuse to start without a key outside development.
4. **`TransferCustody` accepts any string as `newHolder`.** It should be validated against the set of known organisations.
5. **Chaincode uses `time.Now()`.** Fabric chaincode should use `ctx.GetStub().GetTxTimestamp()`; with several endorsing peers, wall-clock time can differ between endorsers and cause endorsement mismatches.
6. **`VerifyIntegrity` compares raw JSON strings**, which is sensitive to key order. Comparing a SHA-256 of a canonical form would be sturdier.
7. **The ML model is trained on synthetic data** (see `docs/ML_EVALUATION.md`). Real validation needs real port/carrier data.
8. **The network is a single-machine demo** (2 orgs + orderer in Docker). It demonstrates the trust model, not geographic distribution or throughput at scale.
9. **README says "JWT sessions", but the code uses opaque random bearer tokens.** Both are valid designs; the documentation should match the code.

## Where each claim is backed by evidence

| Claim | Evidence |
|---|---|
| Role-restricted custody | `blockchain/chaincode/shipment/shipment.go` (`CreateShipment`, `TransferCustody`). Go tests exist in `tests/blockchain/` but are outside the chaincode package and not run in CI |
| API behaviour (Fabric mocked) | `tests/backend/shipment.test.js`, run in CI |
| ML pipeline and per-shipment explanations | `tests/ml/`, run in CI; `docs/ML_EVALUATION.md` reproduced with `python ml/evaluate_model.py` |
