# DLN-Lite: Decentralised Logistics Network

DLN-Lite is a comprehensive full-stack Web3 application designed to demonstrate a supply chain transparency and logistics tracking solution. It leverages **Hyperledger Fabric** for immutable tracking (with Attribute-Based Access Control), **MongoDB** for off-chain state and identity storage, a **Node.js/Express** backend, a **FastAPI** machine learning service for predictive analytics (delay risk scoring), and a **React/Tailwind** frontend dashboard.

---

## 🏗️ Architecture

- **Blockchain (Hyperledger Fabric v2.x)**: 
  - 3 Organizations (Org1, Org2, Orderer).
  - Go-based Smart Contract (`shipment.go`) handling event logs, state updates, and ABAC (Attribute-Based Access Control).
  - Fabric CA per-org issuing unique X.509 identities.
- **Backend (Node.js/Express)**:
  - RESTful APIs to interact with the blockchain and ML services.
  - Generates and encrypts unique Fabric X.509 user identities using AES-256-GCM natively in MongoDB.
  - Manages JWT sessions and user roles (shipper, carrier, customs).
- **ML Service (FastAPI / Python)**:
  - Consumes predictive metrics (cargo weight, distance, weather).
  - Provides risk scoring for shipment delays.
- **Frontend (React)**:
  - Role-based dashboard (Shipper vs Carrier).
  - Modern, responsive UI built with Tailwind CSS.

---

## 🛠️ Prerequisites

To run this project, your machine **must** have the following installed:

1. **Windows Subsystem for Linux (WSL2)** (If you are on Windows. Make sure your default distro is Ubuntu/Debian).
2. **Docker Desktop** (Configured to use WSL2 backend if on Windows).
3. **Node.js** (v18 or higher) and **npm**.
4. **Python** (v3.11+).
5. **Go** (v1.19 or higher) installed inside WSL.
6. **MongoDB** (Ensure MongoDB Community Server is installed locally on port 27017, or update the `.env` files with your Atlas URI).

---

## 🚀 Setup & Installation Guide

### 1. Blockchain Network Setup (via WSL)
Open a WSL terminal (e.g. Ubuntu) and navigate to the `blockchain/network` folder. 
*Note: The script handles downloading hyperledger binaries, cryptogen, and starting docker containers.*

```bash
# Navigate to network folder
cd blockchain/blockchain/network

# Ensure scripts are executable
chmod +x stop-network.sh start-network.sh

# Stop any dangling networks
./stop-network.sh

# Start the Fabric network (generates crypto, starts docker, deploys chaincode)
./start-network.sh
```

### 2. Machine Learning Service
Open a new terminal (Command Prompt/PowerShell) and set up the Python environment:

```cmd
cd ml
python -m venv .venv
# Activate virtual environment
.venv\Scripts\activate

# Install requirements
pip install -r requirements.txt

# Run the FastAPI server
python app.py
```
*(The ML service will run on http://localhost:5000)*

### 3. Node.js Backend
Open a new terminal and prepare the backend server. Make sure your MongoDB instance is running locally on port 27017.

```cmd
cd backend

# Install dependencies
npm install

# Copy environment template and fill in MongoDB details if necessary
copy .env.example .env

# Run the backend server
npm run dev
```
*(The backend service will run on http://localhost:4000)*

### 4. React Frontend
Open a final terminal to run the UI:

```cmd
cd frontend

# Install dependencies
npm install

# Start the app
npm start
```
*(The React app will open automatically at http://localhost:3000)*

---

## 🎯 Quick Start / Automated Script

If you are on Windows and have already set up all prerequisites (npm installed, Python installed, WSL active), you can simply run the provided batch script to spin up the network and all services at once:

```cmd
start-all.bat
```
This will:
1. Stop and restart the Hyperledger Fabric network via WSL.
2. Open three separate command prompt windows for your ML Service, Backend, and Frontend.

---

## 👥 Usage

1. Go to `http://localhost:3000`.
2. Register a new account as a **Shipper** (e.g., `alice@example.com`). This will trigger a backend process that registers and enrolls the user with the Hyperledger Fabric CA, securely storing their encrypted private key in MongoDB.
3. Register a second account as a **Carrier** (e.g., `bob@example.com`).
4. Log in as the Shipper and create a new shipment.
5. Log in as the Carrier, find the shipment, and test the ABAC rules by transferring custody. (The chaincode verifies the `carrier` attribute natively!).

---

## 🧹 Cleanup
To tear down the blockchain network and delete the docker containers:
```bash
# Inside WSL terminal
cd blockchain/blockchain/network
./stop-network.sh
```

---
*Developed for research and demonstration purposes.*
