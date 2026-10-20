import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAllShipments, getSummary } from "../services/api";

const STATUS_CONFIG = {
  IN_TRANSIT: { bg: "rgba(26,108,245,0.14)", color: "#72b3ff", label: "In Transit" },
  AT_PORT: { bg: "rgba(0,212,255,0.14)", color: "#00d4ff", label: "At Port" },
  IN_CUSTOMS: { bg: "rgba(245,166,35,0.16)", color: "#f5a623", label: "In Customs" },
  DELAYED: { bg: "rgba(255,68,85,0.14)", color: "#ff6674", label: "Delayed" },
  DELIVERED: { bg: "rgba(0,230,118,0.14)", color: "#00e676", label: "Delivered" },
  CREATED: { bg: "rgba(255,255,255,0.08)", color: "#d8e1f3", label: "Created" },
};

const METRICS = [
  { key: "total", label: "Shipments on network", color: "#00d4ff", foot: "Cross-org ledger entries" },
  { key: "inTransit", label: "Active in motion", color: "#2080ff", foot: "Currently progressing between checkpoints" },
  { key: "delayed", label: "Delay incidents", color: "#ff6674", foot: "Shipments flagged for disruption" },
];

const timelineItems = [
  {
    title: "Immutable event capture",
    copy: "Shipment checkpoints are committed to the shared ledger for cross-party verification.",
    time: "Consensus layer",
  },
  {
    title: "Risk scoring",
    copy: "Predictions from the ML service flag probable delay windows before they become incidents.",
    time: "Predictive layer",
  },
  {
    title: "Operator action",
    copy: "Routing, customs and exception management can be handled from the same command surface.",
    time: "Operations layer",
  },
];

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([getSummary(), getAllShipments()])
      .then(([summaryRes, shipmentRes]) => {
        setSummary(summaryRes.data || {});
        setShipments(shipmentRes.data || []);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => setLoading(false));
  }, []);

  const activeShipments = shipments.filter((shipment) => shipment.status !== "DELIVERED");
  const featured = [...activeShipments]
    .sort((a, b) => (b.delayRiskScore || 0) - (a.delayRiskScore || 0))
    .slice(0, 5);
  const averageRisk = summary?.avgRiskScore ? `${Math.round(summary.avgRiskScore * 100)}%` : "0%";

  if (loading) {
    return (
      <div className="cf-page-shell">
        <p className="cf-microcopy">Synchronising network state</p>
        <h1>Loading command surface...</h1>
      </div>
    );
  }

  return (
    <div>
      <section className="cf-hero">
        <div className="cf-panel">
          <p className="cf-microcopy">3D logistics platform interface</p>
          <h1 className="cf-panel-title">Shared visibility for every shipment handoff.</h1>
          <p className="cf-panel-subtitle">
            This UI brings the Cargo Intel concept into DLN-Lite: a cinematic operations layer with
            blockchain verification, predictive risk scoring and live exception tracking in one place.
          </p>

          <div className="cf-hero-row">
            <span className="cf-pill">
              <span className="cf-dot" />
              Hyperledger-backed event chain
            </span>
            <button className="cf-primary-btn" onClick={() => navigate("/shipments/new")}>
              Create shipment
            </button>
            <button className="cf-secondary-btn" onClick={() => navigate("/shipments")}>
              Explore ledger
            </button>
          </div>

          <div className="cf-stats-row">
            <div className="cf-stat-card">
              <div className="cf-stat-value">{summary?.total || 0}</div>
              <div className="cf-stat-label">Tracked shipments</div>
            </div>
            <div className="cf-stat-card">
              <div className="cf-stat-value">{summary?.inTransit || 0}</div>
              <div className="cf-stat-label">Moving now</div>
            </div>
            <div className="cf-stat-card">
              <div className="cf-stat-value">{averageRisk}</div>
              <div className="cf-stat-label">Average delay risk</div>
            </div>
          </div>
        </div>

        <div className="cf-scene" aria-hidden="true">
          <div className="cf-scene-inner">
            <div className="cf-scene-label">Warehouse to port simulation</div>
            <div className="cf-scene-visual">
              <div className="cf-ship-node" />
              <div className="cf-route-node" />
              <div className="cf-route-line" />
              <div className="cf-cargo-node" />
            </div>
          </div>
        </div>
      </section>

      <div className="cf-section-header">
        <div>
          <h2 className="cf-section-title">Operations overview</h2>
          <p className="cf-section-text">
            The metrics and watchlist below stay wired into the current API while adopting the new interface language.
          </p>
        </div>
      </div>

      <section className="cf-metric-grid">
        {METRICS.map((metric) => (
          <article
            key={metric.key}
            className="cf-metric-card"
            style={{
              "--metric-color": metric.color,
              "--metric-glow": `${metric.color}22`,
            }}
          >
            <div className="cf-metric-kicker">{metric.label}</div>
            <div className="cf-metric-value">{summary?.[metric.key] || 0}</div>
            <div className="cf-metric-foot">{metric.foot}</div>
          </article>
        ))}
      </section>

      <section className="cf-detail-grid">
        <article className="cf-list-card">
          <div className="cf-card-header">
            <div>
              <h3 className="cf-card-title">Priority shipment watchlist</h3>
              <p className="cf-section-text">Highest-risk in-flight shipments surfaced for action.</p>
            </div>
            <span className="cf-chip">{featured.length} active</span>
          </div>

          <div className="cf-shipment-list">
            {featured.length === 0 ? (
              <div className="cf-shipment-row">
                <div className="cf-shipment-meta">
                  <div className="cf-shipment-id">No active high-risk shipments</div>
                  <div className="cf-shipment-route">The network is currently stable.</div>
                </div>
              </div>
            ) : (
              featured.map((shipment) => {
                const status = STATUS_CONFIG[shipment.status] || STATUS_CONFIG.CREATED;
                return (
                  <div
                    key={shipment.shipmentId}
                    className="cf-shipment-row"
                    onClick={() => navigate(`/shipments/${shipment.shipmentId}`)}
                  >
                    <div className="cf-shipment-meta">
                      <div className="cf-shipment-id">{shipment.shipmentId}</div>
                      <div className="cf-shipment-route">
                        {shipment.origin} to {shipment.destination} via {shipment.carrier}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div className="cf-pill">Risk {(Math.round((shipment.delayRiskScore || 0) * 100))}%</div>
                      <span
                        className="cf-status-pill"
                        style={{
                          "--status-bg": status.bg,
                          "--status-color": status.color,
                        }}
                      >
                        {status.label}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <aside className="cf-list-card">
          <div className="cf-card-header">
            <div>
              <h3 className="cf-card-title">How this UI maps to the platform</h3>
              <p className="cf-section-text">The reference design translated into app-ready surfaces.</p>
            </div>
          </div>

          <div className="cf-timeline">
            {timelineItems.map((item) => (
              <div key={item.title} className="cf-timeline-item">
                <div className="cf-timeline-title">{item.title}</div>
                <div className="cf-timeline-copy">{item.copy}</div>
                <div className="cf-timeline-time">{item.time}</div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
