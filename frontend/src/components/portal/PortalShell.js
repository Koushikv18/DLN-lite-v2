import React, { useEffect, useMemo, useState } from "react";
import { getAllShipments, getSummary } from "../../services/api";
import Analytics from "../../pages/Analytics";
import CreateShipment from "../../pages/CreateShipment";
import DisruptionFeed from "../../pages/DisruptionFeed";
import ImmutabilityDemo from "../../pages/ImmutabilityDemo";
import RiskPredictor from "../../pages/RiskPredictor";
import RouteOptimizer from "../../pages/RouteOptimizer";
import { CarrierScene, CustomsScene, ShipperScene, WorldBackground } from "./SceneCanvases";
import WatchlistPanel from "./WatchlistPanel";

const ROLE_META = {
  shipper: {
    name: "Shipper",
    icon: "🏭",
    badgeClass: "badge-shipper",
    description: "Create & manage shipments",
    panelTitle: "Shipper Dashboard",
    panelSub: "Create blockchain-secured shipments — warehouse to port",
    statusClass: "status-cleared",
    statusText: "Active",
  },
  carrier: {
    name: "Carrier",
    icon: "🚢",
    badgeClass: "badge-carrier",
    description: "Track routes & alerts",
    panelTitle: "Carrier Operations",
    panelSub: "Real-time 3D fleet monitoring — ocean crossing with live weather",
    statusClass: "status-transit",
    statusText: "In Service",
  },
  customs: {
    name: "Customs",
    icon: "🛃",
    badgeClass: "badge-customs",
    description: "Verify & clear cargo",
    panelTitle: "Customs & Clearance",
    panelSub: "Blockchain-verified cargo inspection — port terminal live view",
    statusClass: "status-pending",
    statusText: "On Duty",
  },
};

const STORAGE_KEY = "dln-lite-role-session";
export default function PortalShell() {
  const [selectedRole, setSelectedRole] = useState("shipper");
  const [currentRole, setCurrentRole] = useState(null);
  const [currentUser, setCurrentUser] = useState("");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authOpen, setAuthOpen] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [summary, setSummary] = useState(null);
  const [shipments, setShipments] = useState([]);

  const syncPortalData = async () => {
    const [summaryResponse, shipmentResponse] = await Promise.all([
      getSummary().catch(() => ({ data: null })),
      getAllShipments().catch(() => ({ data: [] })),
    ]);
    setSummary(summaryResponse.data || null);
    setShipments(shipmentResponse.data || []);
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (saved?.role && saved?.user) {
        setCurrentRole(saved.role);
        setCurrentUser(saved.user);
      }
    } catch {
      // Ignore corrupted local session state.
    }
  }, []);

  useEffect(() => {
    syncPortalData();

    const intervalId = window.setInterval(syncPortalData, 10000);
    const handleFocus = () => {
      syncPortalData();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const totals = useMemo(() => {
    const total = shipments.length || summary?.total || 0;
    const cleared = shipments.filter((shipment) => shipment.status === "DELIVERED").length || summary?.delivered || 0;
    const atRisk = shipments.filter((shipment) => (shipment.delayRiskScore || 0) >= 0.5).length || summary?.highRisk || 0;
    const inTransit = shipments.filter((shipment) => shipment.status === "IN_TRANSIT").length || summary?.inTransit || 0;
    const customsQueue = shipments.filter((shipment) => shipment.status === "IN_CUSTOMS").length;
    return { total, cleared, atRisk, inTransit, customsQueue };
  }, [shipments, summary]);

  const openAuth = (role) => {
    setSelectedRole(role);
    setAuthOpen(true);
  };

  const closeAuth = () => setAuthOpen(false);

  const doLogin = () => {
    setLoadingLogin(true);
    window.setTimeout(() => {
      const user = authForm.name.trim() || "Demo User";
      setCurrentRole(selectedRole);
      setCurrentUser(user);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ role: selectedRole, user }));
      setAuthOpen(false);
      setLoadingLogin(false);
    }, 650);
  };

  const logout = () => {
    setCurrentRole(null);
    setCurrentUser("");
    setAuthForm({ name: "", email: "", password: "" });
    window.localStorage.removeItem(STORAGE_KEY);
  };

  const role = currentRole ? ROLE_META[currentRole] : null;

  return (
    <div className="portal-shell">
      <WorldBackground />

      {!role ? (
        <div id="landing" className="screen active">
          <div className="portal-landing-wrap">
            <div className="live-ticker"><span className="dot-ping" />LIVE: 2,847 shipments tracked on-chain</div>
            <div className="logo">
              <div className="logo-icon">🌐</div>
              <div className="logo-text">Cargo Intel</div>
            </div>
            <div className="hero-tag">Blockchain Logistics Platform</div>
            <h1 className="hero-title">Global Trade,<br />On the Chain</h1>
            <p className="hero-sub">
              End-to-end shipment visibility with immutable blockchain records, AI-powered disruption alerts,
              and real-time cargo tracking across all roles.
            </p>
            <div className="stats-row">
              <div className="stat-item"><div className="stat-num">{totals.total || 142}</div><div className="stat-lbl">Shipments</div></div>
              <div className="stat-item"><div className="stat-num">{summary?.onTimeRate ? `${(summary.onTimeRate * 100).toFixed(1)}%` : "98.7%"}</div><div className="stat-lbl">On-time</div></div>
              <div className="stat-item"><div className="stat-num">56</div><div className="stat-lbl">Ports</div></div>
              <div className="stat-item"><div className="stat-num">0</div><div className="stat-lbl">Fraud</div></div>
            </div>
            <div className="portal-role-copy">Select your role to get started</div>
            <div className="role-cards">
              {Object.entries(ROLE_META).map(([key, meta]) => (
                <button key={key} className="role-card portal-role-button" onClick={() => openAuth(key)}>
                  <div className="role-icon">{meta.icon}</div>
                  <div className="role-name">{meta.name}</div>
                  <div className="role-desc">{meta.description}</div>
                </button>
              ))}
            </div>
            <div className="portal-footer-copy">Secured by blockchain verification · Powered by ML risk scoring · Role-based access</div>
          </div>
        </div>
      ) : (
        <div id="app" className="screen active portal-app-screen">
          <div className="topbar">
            <div className="topbar-logo">⛓ Cargo Intel</div>
            <div className="nav-tabs" id="nav-tabs">
              <button className="nav-tab active" type="button">{role.icon} {role.name}</button>
            </div>
            <div className="user-badge">
              <div className="user-dot" />
              <span>{currentUser}</span>
              <button className="btn btn-sm btn-outline" onClick={logout} style={{ marginLeft: 8 }}>Logout</button>
            </div>
          </div>

          <div className="dash-content">
            {currentRole === "shipper" ? <ShipperDashboard totals={totals} shipments={shipments} onShipmentCreated={syncPortalData} /> : null}
            {currentRole === "carrier" ? <CarrierDashboard totals={totals} shipments={shipments} /> : null}
            {currentRole === "customs" ? <CustomsDashboard totals={totals} shipments={shipments} /> : null}
          </div>
        </div>
      )}

      <div className={`modal-backdrop${authOpen ? " open" : ""}`} id="auth-modal">
        <div className="modal">
          <button className="modal-close" onClick={closeAuth}>✕</button>
          <h3 id="auth-title">Sign In as {ROLE_META[selectedRole].name}</h3>
          <div id="auth-badge" className={`modal-role-badge ${ROLE_META[selectedRole].badgeClass}`}>{ROLE_META[selectedRole].name}</div>
          <div className="field">
            <label>Full Name</label>
            <input value={authForm.name} onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))} placeholder="John Maritime" />
          </div>
          <div className="field">
            <label>Email Address</label>
            <input type="email" value={authForm.email} onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))} placeholder="you@company.com" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} placeholder="••••••••" />
          </div>
          <button className={`btn btn-primary${loadingLogin ? " loading" : ""}`} onClick={doLogin}>
            <span className="btn-label">Enter Dashboard</span>
            <span className="loader" />
          </button>
          <div className="portal-modal-copy">JWT secured · Role-based access · Encrypted</div>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ roleKey }) {
  const role = ROLE_META[roleKey];
  return (
    <div className="panel-header">
      <div>
        <div className="panel-title">{role.panelTitle}</div>
        <div className="panel-sub">{role.panelSub}</div>
      </div>
      <div className={`status ${role.statusClass}`}>{role.statusText}</div>
    </div>
  );
}

function ShipperDashboard({ totals, shipments, onShipmentCreated }) {
  return (
    <div className="dash-panel active" id="panel-shipper">
      <PanelHeader roleKey="shipper" />
      <div className="scene-shipper">
        <ShipperScene />
        <div className="scene-label">Warehouse Operations — Port Dispatch Live</div>
      </div>

      <div className="grid-3 portal-metrics">
        <MetricCard label="Total Shipments" value={totals.total} foot="All time" />
        <MetricCard label="On Blockchain" value={totals.total} foot="Immutable records" />
        <MetricCard label="Cleared" value={totals.cleared} foot="Delivered shipments" />
      </div>

      <div className="portal-dashboard-grid">
        <CreateShipment embedded onCreated={onShipmentCreated} />
        <WatchlistPanel shipments={shipments} />
        <Analytics embedded />
        <DisruptionFeed embedded />
        <RouteOptimizer embedded />
      </div>
    </div>
  );
}

function CarrierDashboard({ totals, shipments }) {
  return (
    <div className="dash-panel active" id="panel-carrier">
      <PanelHeader roleKey="carrier" />
      <div className="scene-carrier">
        <CarrierScene />
        <div className="scene-label portal-scene-corner">LIVE FLEET · VESSEL MSC ORNELLA</div>
      </div>

      <div className="grid-3 portal-metrics">
        <MetricCard label="Active Routes" value={totals.inTransit || 8} foot="Vessels in motion" />
        <MetricCard label="Watchlist" value={totals.atRisk} foot="Require intervention" />
        <MetricCard label="Delivered" value={totals.cleared} foot="Completed journeys" />
      </div>

      <div className="portal-dashboard-grid">
        <WatchlistPanel
          shipments={shipments}
          title="Active Shipments"
          subtitle="Newest active carrier records across the network"
          sortMode="recent"
        />
        <Analytics embedded />
        <RiskPredictor embedded />
        <DisruptionFeed embedded />
      </div>
    </div>
  );
}

function CustomsDashboard({ totals, shipments }) {
  return (
    <div className="dash-panel active" id="panel-customs">
      <PanelHeader roleKey="customs" />
      <div className="scene-customs">
        <CustomsScene />
        <div className="scene-label">Port Terminal — Container Inspection Live</div>
      </div>

      <div className="grid-3 portal-metrics">
        <MetricCard label="Incoming" value={totals.customsQueue} foot="Awaiting inspection" color="var(--amber)" />
        <MetricCard label="Cleared" value={totals.cleared} foot="Delivered shipments" color="var(--green)" />
        <MetricCard label="At Risk" value={totals.atRisk} foot="Need review" color="var(--red)" />
      </div>

      <div className="portal-dashboard-grid">
        <WatchlistPanel
          shipments={shipments}
          title="Incoming Shipments"
          subtitle="Active shipments awaiting carrier or customs review"
          sortMode="recent"
        />
        <Analytics embedded />
        <DisruptionFeed embedded />
        <ImmutabilityDemo embedded shipments={shipments} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, foot, color = "var(--cyan)" }) {
  return (
    <div className="card">
      <div className="card-header">{label}</div>
      <div className="metric" style={{ color }}>{value}</div>
      <div className="metric-label">{foot}</div>
    </div>
  );
}
