# DLN-Lite — Presentation Guide

## The 30-second pitch

> When a shipment crosses borders, the shipper, the carrier and customs each keep their own record, and any of them can quietly change theirs. DLN-Lite puts the custody trail on a permissioned blockchain where **the ledger itself decides who may do what**: only a shipper can create a shipment, only a carrier can hand it over. Every event is also sealed into a **SHA-256 hash chain**, so anyone holding an exported copy can prove, **offline and without trusting us**, that it hasn't been altered. A machine-learning service adds delay-risk scores with a per-shipment explanation of *why*.

## What is genuinely different about this project

1. **Portable proof of integrity.** Most blockchain-logistics demos stop at "it's on the ledger". Here the evidence survives leaving the system: a PDF or JSON export can be verified by a stranger with one command.
2. **Rules enforced at two layers.** Roles are checked in the API *and* independently inside the chaincode using the caller's certificate, so bypassing the API doesn't help.
3. **Every action is signed by the person who did it.** Each user has their own Fabric identity, stored encrypted, and the audit trail records who acted.
4. **An honest ML component.** Delay scores come with per-shipment explanations (TreeSHAP), and the evaluation says plainly that the data is synthetic and what the numbers do and don't prove.
5. **Verified, not just claimed.** 110 automated tests across Go, Node and Python, including mutation checks showing the tests fail when a security rule is removed.

## Demo script (about 5 minutes)

### Part A: the offline tamper check (60 seconds, needs no network or Docker)

```bash
node scripts/verifyExport.js docs/sample/shipment-intact.json
node scripts/verifyExport.js docs/sample/shipment-tampered.json
```

Say: *"This is a shipment exported from the ledger. The first check passes. In the second copy, someone changed one customs checkpoint after the fact, rewriting where it happened. The tool names the exact event that no longer matches its hash. No blockchain, no database, no internet: just the file."*

Expected: the first prints `INTACT` and exits 0; the second prints `TAMPERED at event 3` and exits 1.

### Part B: the live portal (3 minutes)

1. Check the badge in the top bar says **LIVE · BLOCKCHAIN**. If it says **DEMO DATA**, the API is not reaching the ledger. Fix that before presenting.
2. Sign in as a **shipper**, create a shipment. Say: *"This transaction is signed with my own certificate."*
3. Sign in as a **carrier**, record milestones. (Optional, to show the rules are enforced: call `POST /api/shipments` with the carrier's token using `curl`; it answers `403 Access denied`.)
4. Sign in as **customs**, open the verification tool: *record vs ledger*, then the *custody chain* with its fingerprint and the "ledger and independent check agree" line.
5. Open `/immutability-demo`, fetch a record, press **Inject tamper**, verify. It should list exactly which fields were changed.

### Part C: the ML in 30 seconds

Open `/risk-predictor`. Say: *"Each score comes with the reasons for this specific shipment. The model is trained on synthetic data, so I treat it as a working pipeline rather than a claim about real-world accuracy, and the evaluation document shows the numbers and the caveats."*

### If something fails live

Part A needs only Node. Keep a 2-minute screen recording of Part B as a backup.

## Numbers you can quote (all reproducible)

| Claim | Source |
|---|---|
| 110 automated tests: 26 Go (chaincode), 59 Jest (API, hash chain, CLI, portal), 25 pytest (ML) | run the three suites listed in the README |
| ML 5-fold CV: XGBoost accuracy 0.838, AUC 0.918; Logistic Regression 0.793; Random Forest 0.835 | `docs/ML_EVALUATION.md` (`python ml/evaluate_model.py`) |
| The rule that generated the labels scores 0.844 accuracy, so no model can honestly beat that | same document |

## Questions you should expect, with honest answers

**Why a blockchain? Why not a database with audit logs?**
A database admin can edit the data *and* the audit log. Here no single organisation controls the ledger, the history is append-only, and the rules about who may act are enforced by every peer. The hash chain extends that protection to copies that leave the system. If one company owned everything, a database would be simpler, and I'd say so.

**Who runs the peers? Isn't this just one machine?**
In this demo, yes: two organisations and an orderer on one machine in Docker. It demonstrates the trust model, not geographic distribution. In production each organisation runs its own peers.

**What if the Certificate Authority is compromised?**
Then an attacker could issue identities with any role. The chaincode trusts the certificate's `role` attribute, so CA security is the root of trust. That is true of every permissioned Fabric network, and is why the CA is run by the consortium, not by one party.

**What if someone deletes the last few events from an export?**
A shorter chain is still internally consistent, so the chain alone cannot catch that. The head hash is the fingerprint: if it is recorded outside the system (on the bill of lading, in an email, on a QR code), a truncated history has a different head. The ledger's own history also still holds the originals.

**Does the chain prove the events were true?**
No. It proves they haven't been *altered* since they were recorded. If a carrier records a false location, the chain preserves the false record and shows who recorded it. Sensors or a second attesting party would be the next step.

**Is the ML real?**
The pipeline is real (training, serving, explanations, evaluation). The data is synthetic and the labels come from a known rule, so the accuracy shows the model recovers that rule and nothing more. Validating on real port and carrier data is the main future work. I say this before anyone has to ask.

**What did you build versus reuse?**
Reused: Hyperledger Fabric, Express, React, XGBoost. Built: the chaincode and its access-control and hash-chain logic, the per-user identity and encrypted key storage, the API and auth layer, the verifier (in Go, Node and a standalone CLI), the ML service and its explanations and evaluation, and the test suites.

**What would you do with more time?**
Enroll each organisation into its own MSP, anchor head hashes outside the ledger (for example in the consignee's email or a QR code), replace the synthetic data with a real dataset, add event-level signatures from sensors, and run a throughput benchmark on a multi-machine network.

**How does it handle privacy?**
Only shipment state and custody events go on the ledger; contact details and notes stay in the off-chain database. Fabric channels can further restrict who sees what. Personal data on an immutable ledger is a real GDPR concern, which is why it is kept off-chain.

**What are the known weaknesses?**
They are listed in `docs/ARCHITECTURE.md`: all users enroll into one MSP in the demo, the custody holder is free text, the portal falls back to demo data when the API fails (now flagged with a badge), and the full stack was unit-tested but not integration-tested on a live network in my review environment.
