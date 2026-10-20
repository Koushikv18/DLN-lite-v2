import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAllShipments } from "../services/api";

const STATUS_CONFIG = {
  IN_TRANSIT: { bg: "rgba(26,108,245,0.14)", color: "#72b3ff", label: "In Transit" },
  AT_PORT: { bg: "rgba(0,212,255,0.14)", color: "#00d4ff", label: "At Port" },
  IN_CUSTOMS: { bg: "rgba(245,166,35,0.16)", color: "#f5a623", label: "In Customs" },
  DELAYED: { bg: "rgba(255,68,85,0.14)", color: "#ff6674", label: "Delayed" },
  DELIVERED: { bg: "rgba(0,230,118,0.14)", color: "#00e676", label: "Delivered" },
  CREATED: { bg: "rgba(255,255,255,0.08)", color: "#d8e1f3", label: "Created" },
};

export default function ShipmentList() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const navigate = useNavigate();

  useEffect(() => {
    getAllShipments()
      .then((response) => setShipments(response.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return shipments.filter((shipment) => {
      const matchesStatus = statusFilter === "ALL" || shipment.status === statusFilter;
      if (!matchesStatus) return false;
      if (!search.trim()) return true;
      const query = search.toLowerCase();
      return [
        shipment.shipmentId,
        shipment.origin,
        shipment.destination,
        shipment.carrier,
        shipment.containerId,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [shipments, search, statusFilter]);

  const statuses = ["ALL", "CREATED", "IN_TRANSIT", "AT_PORT", "IN_CUSTOMS", "DELAYED", "DELIVERED"];

  if (loading) {
    return (
      <div className="cf-page-shell">
        <p className="cf-microcopy">Ledger synchronisation</p>
        <h1>Loading shipments...</h1>
      </div>
    );
  }

  return (
    <div>
      <div className="cf-page-head">
        <div>
          <p className="cf-page-kicker">Shipment explorer</p>
          <h1 className="cf-page-title">Track every movement across the network.</h1>
          <p className="cf-page-copy">
            Search the shared ledger, filter by operational state, and drill into any shipment record.
          </p>
        </div>
        <button className="cf-primary-btn" onClick={() => navigate("/shipments/new")}>
          Create shipment
        </button>
      </div>

      <section className="cf-card" style={{ marginBottom: 18 }}>
        <div className="cf-grid-2" style={{ alignItems: "start" }}>
          <div className="cf-field">
            <label htmlFor="shipment-search">Search ledger records</label>
            <input
              id="shipment-search"
              className="cf-input"
              placeholder="ID, route, carrier or container"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div>
            <div className="cf-card-label">Status filter</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {statuses.map((status) => {
                const config = STATUS_CONFIG[status];
                const active = statusFilter === status;
                return (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={active ? "cf-primary-btn" : "cf-secondary-btn"}
                    style={{
                      width: "auto",
                      padding: "8px 12px",
                      fontSize: 12,
                      background: active ? config?.bg || "linear-gradient(135deg,var(--blue),var(--cyan))" : undefined,
                      color: active ? config?.color || "#fff" : undefined,
                    }}
                  >
                    {status.replaceAll("_", " ")}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="cf-list-card">
        <div className="cf-card-header">
          <div>
            <h2 className="cf-card-title">Ledger shipment inventory</h2>
            <p className="cf-section-text">
              {filtered.length} of {shipments.length} records match the current view.
            </p>
          </div>
        </div>

        <div className="cf-shipment-list">
          {filtered.length === 0 ? (
            <div className="cf-empty">No shipments match this filter set.</div>
          ) : (
            filtered.map((shipment) => {
              const status = STATUS_CONFIG[shipment.status] || STATUS_CONFIG.CREATED;
              const risk = Math.round((shipment.delayRiskScore || 0) * 100);
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
                    <div className="cf-timeline-time">
                      {shipment.cargoType} · {(shipment.weightKg || 0).toLocaleString()} kg · container {shipment.containerId}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <div className="cf-pill">Risk {risk}%</div>
                    <span
                      className="cf-status-pill"
                      style={{ "--status-bg": status.bg, "--status-color": status.color }}
                    >
                      {status.label}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
