// ─────────────────────────────────────────────────────────────────────────────
// api.js — centralised API service
// All HTTP calls to the backend go through here.
// ─────────────────────────────────────────────────────────────────────────────

import axios from "axios";

function resolveBaseUrl() {
  const configured = (process.env.REACT_APP_API_URL || "").trim();
  if (!configured) return "http://localhost:4000/api";
  return configured.endsWith("/api") ? configured : `${configured.replace(/\/+$/, "")}/api`;
}

const BASE_URL = resolveBaseUrl();

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

// ── Session handling ───────────────────────────────────────────────────────
// The portal at "/" signs users in and stores the session under this key.
// Every request carries that token, so the backend can sign blockchain
// transactions with the signed-in user's own Fabric identity.
const SESSION_KEY = "dln-lite-auth-session";

api.interceptors.request.use((config) => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    if (saved?.token) {
      config.headers.Authorization = `Bearer ${saved.token}`;
    }
  } catch {
    // Ignore corrupted local session state.
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 = missing/expired session: send the user back to the portal to sign in.
    if (error?.response?.status === 401 && window.location.pathname !== "/") {
      window.localStorage.removeItem(SESSION_KEY);
      window.location.assign("/");
    }
    return Promise.reject(error);
  }
);

// ── Shipments ──────────────────────────────────────────────────────────────

export const getAllShipments = () =>
  api.get("/shipments").then((r) => r.data);

export const getShipment = (id) =>
  api.get(`/shipments/${id}`).then((r) => r.data);

export const createShipment = (data) =>
  api.post("/shipments", data).then((r) => r.data);

export const recordEvent = (id, eventData) =>
  api.post(`/shipments/${id}/events`, eventData).then((r) => r.data);

export const transferCustody = (id, data) =>
  api.post(`/shipments/${id}/transfer`, data).then((r) => r.data);

export const markDelivered = (id) =>
  api.post(`/shipments/${id}/deliver`).then((r) => r.data);

export const getShipmentHistory = (id) =>
  api.get(`/shipments/${id}/history`).then((r) => r.data);

// ── ML ─────────────────────────────────────────────────────────────────────

export const predictDelay = (shipmentId, enrichment = {}) =>
  api.post(`/ml/predict/${shipmentId}`, enrichment).then((r) => r.data);

export const predictManual = (features) =>
  api.post("/ml/predict-manual", features).then((r) => r.data);

export const runBatchUpdate = () =>
  api.get("/ml/batch-update").then((r) => r.data);

// ── Analytics ──────────────────────────────────────────────────────────────

export const getSummary = () =>
  api.get("/analytics/summary").then((r) => r.data);

export const getRiskDistribution = () =>
  api.get("/analytics/risk-distribution").then((r) => r.data);

export const getTopRoutes = () =>
  api.get("/analytics/top-routes").then((r) => r.data);

// ── Health ─────────────────────────────────────────────────────────────────

export const getHealth = () =>
  api.get("/health").then((r) => r.data);

export default api;

// ── Status update & Immutability ────────────────────────────────────────────
export const updateStatus = (id, status, reason) =>
  api.put(`/shipments/${id}/status`, { status, reason }).then(r => r.data);

export const verifyIntegrity = (id, claimedData) =>
  api.post(`/shipments/${id}/verify`, { claimedData }).then(r => r.data);
