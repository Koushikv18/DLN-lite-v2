# DLN-Lite Setup Guide

Complete step-by-step instructions to get DLN-Lite running locally.

---

## Prerequisites

Install these before starting:

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18+ | https://nodejs.org |
| Python | 3.10+ | https://python.org |
| Go | 1.19+ | https://golang.org |
| Git | Any | https://git-scm.com |

---

## Run Each Service Manually (Development)

### Step 1: ML Service (Python)

```bash
cd ml

# Install dependencies
pip install -r requirements.txt

# Train the XGBoost model (generates models/xgboost_model.pkl)
python train_model.py

# Start the Flask server
python app.py
# → Running on http://localhost:5000
```

### Step 2: Backend API (Node.js)

```bash
cd backend

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start the API server
npm run dev
# → Running on http://localhost:4000
```

If MongoDB is not available, the backend falls back to an in-memory metadata store for local development.

### Step 3: Frontend (React)

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm start
# → Opens http://localhost:3000 automatically
```

### Step 4: Seed data

```bash
cd scripts
node seedData.js
```

---

## Optional Blockchain Setup (Advanced)

Only needed if you want a REAL Hyperledger Fabric network (not just the app).

### Prerequisites

Download Fabric binaries:

```bash
curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.0 1.5.0
export PATH=$PATH:$PWD/fabric-samples/bin
```

### Start the network

```bash
cd blockchain/network

# Make scripts executable
chmod +x start-network.sh stop-network.sh

# Start everything (generates crypto, creates channel, deploys chaincode)
./start-network.sh
```

### Enroll the admin identity

```bash
cd scripts
npm install
node enrollAdmin.js
```

### Verify network is running

```bash
docker ps | grep dln
# Should see: orderer, peer0.org1, peer0.org2, ca containers
```

### Stop the network

```bash
cd blockchain/network
./stop-network.sh
```

---

## Running Tests

### Backend tests (Jest)

```bash
# From root
npm install --prefix backend
npx jest --config jest.config.json
```

### ML tests (pytest)

```bash
# From root
pip install pytest
python -m pytest tests/ml/ -v
```

### Blockchain tests (Go)

```bash
cd tests/blockchain
go test ./... -v
```

---

## API Quick Reference

Base URL: `http://localhost:4000/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /shipments | All shipments |
| GET | /shipments/:id | Single shipment |
| POST | /shipments | Create shipment |
| POST | /shipments/:id/events | Record event |
| POST | /shipments/:id/transfer | Transfer custody |
| POST | /shipments/:id/deliver | Mark delivered |
| GET | /shipments/:id/history | Blockchain audit trail |
| POST | /ml/predict/:id | ML prediction for shipment |
| POST | /ml/predict-manual | Custom feature prediction |
| GET | /ml/batch-update | Update all risk scores |
| GET | /analytics/summary | Dashboard headline stats |
| GET | /analytics/risk-distribution | Risk band breakdown |
| GET | /analytics/top-routes | Most active routes |
| GET | /health | System health check |

---

## Troubleshooting

**ML service not connecting**
- Check it's running: `curl http://localhost:5000/health`
- If model not found: run `python ml/train_model.py` first

**MongoDB connection refused**
- Start a local MongoDB instance, or let the backend run with its in-memory fallback for development.

**Fabric network won't start**
- Make sure the required Fabric container runtime is available
- Run `./stop-network.sh` first to clean previous state

**Frontend shows blank page**
- Check backend is running: `curl http://localhost:4000/api/health`
- Check browser console for CORS errors

---

## Project Structure Reference

```
dln-lite/
├── blockchain/
│   ├── chaincode/shipment/
│   │   ├── shipment.go          ← Smart contract (Go)
│   │   └── go.mod
│   └── network/
│       ├── crypto-config.yaml   ← Org definitions
│       ├── configtx.yaml        ← Channel policies
│       ├── connection-profile.json
│       ├── start-network.sh
│       └── stop-network.sh
├── backend/
│   ├── server.js                ← Express entry point
│   ├── routes/                  ← API endpoints
│   ├── services/
│   │   ├── fabricService.js     ← Blockchain calls
│   │   └── mlService.js         ← ML API calls
│   ├── models/ShipmentMeta.js   ← MongoDB schema
│   └── utils/
├── ml/
│   ├── app.py                   ← Flask server
│   ├── predictor.py             ← XGBoost inference
│   ├── train_model.py           ← Training script
│   └── utils.py                 ← Feature encoding
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.js
│       │   ├── ShipmentList.js
│       │   ├── ShipmentDetail.js
│       │   ├── CreateShipment.js
│       │   ├── Analytics.js
│       │   └── RiskPredictor.js
│       ├── components/Layout.js
│       └── services/api.js
├── tests/
│   ├── backend/shipment.test.js
│   ├── ml/test_predictor.py
│   └── blockchain/shipment_test.go
├── scripts/
│   ├── enrollAdmin.js
│   └── seedData.js
├── docker/fabric-docker-compose.yml
└── README.md
```
