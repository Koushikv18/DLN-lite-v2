import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getShipment, getShipmentHistory, recordEvent, markDelivered } from "../services/api";

const STATUS_CONFIG = {
  IN_TRANSIT: { bg: "rgba(96,165,250,0.12)", text: "#60a5fa", dot: "#3b82f6", label: "In Transit" },
  AT_PORT: { bg: "rgba(56,189,248,0.12)", text: "#38bdf8", dot: "#0ea5e9", label: "At Port" },
  IN_CUSTOMS: { bg: "rgba(167,139,250,0.12)", text: "#a78bfa", dot: "#8b5cf6", label: "In Customs" },
  DELAYED: { bg: "rgba(239,68,68,0.12)", text: "#f87171", dot: "#ef4444", label: "Delayed" },
  DELIVERED: { bg: "rgba(34,197,94,0.12)", text: "#4ade80", dot: "#22c55e", label: "Delivered" },
  CREATED: { bg: "rgba(148,163,184,0.12)", text: "#94a3b8", dot: "#64748b", label: "Created" },
};
const riskColor = s => s >= 0.7 ? "#ef4444" : s >= 0.4 ? "#f59e0b" : "#22c55e";
const EVT_ICONS = { SHIPMENT_CREATED: "M12 4v16m8-8H4", DEPARTED_PORT: "M13 10V3L4 14h7v7l9-11h-7z", ARRIVED_PORT: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z", CUSTOMS_ENTRY: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", CUSTOMS_CLEARED: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", DELIVERED: "M5 13l4 4L19 7", DELAY_REPORTED: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", STATUS_UPDATED: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" };
const EVT_COLORS = { SHIPMENT_CREATED: "#60a5fa", DEPARTED_PORT: "#a78bfa", ARRIVED_PORT: "#38bdf8", CUSTOMS_ENTRY: "#f59e0b", CUSTOMS_CLEARED: "#22c55e", DELIVERED: "#4ade80", DELAY_REPORTED: "#ef4444", STATUS_UPDATED: "#fb923c" };
const EVT_TYPES = ["DEPARTED_PORT", "ARRIVED_PORT", "CUSTOMS_ENTRY", "CUSTOMS_CLEARED", "TRANSSHIPMENT", "DELAY_REPORTED", "INSPECTION"];

const inputStyle = { width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0", padding: "11px 14px", borderRadius: 9, fontSize: 14, outline: "none", boxSizing: "border-box" };

export default function ShipmentDetail() {
  const { id } = useParams(); const navigate = useNavigate();
  const [shipment, setShipment] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ eventType: "DEPARTED_PORT", location: "", description: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([getShipment(id), getShipmentHistory(id)])
      .then(([s, h]) => { setShipment(s.data); setHistory(h.data || []); })
      .catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const handleEvent = async () => {
    if (!form.location || !form.description) return alert("Fill all fields");
    setSubmitting(true);
    try { const r = await recordEvent(id, form.eventType, form.location, form.description); setShipment(r.data); setShowModal(false); setForm({ eventType: "DEPARTED_PORT", location: "", description: "" }); }
    catch (e) { alert("Error: " + e.message); } finally { setSubmitting(false); }
  };

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", color: "#64748b" }}>Loading shipment...</div>;
  if (!shipment) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", color: "#64748b" }}>Shipment not found.</div>;

  const sc = STATUS_CONFIG[shipment.status] || STATUS_CONFIG.CREATED;
  const risk = shipment.delayRiskScore || 0;

  return (
    <div>
      <button onClick={() => navigate("/shipments")} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13, marginBottom: 20, display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Back to Shipments
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#60a5fa", letterSpacing: "-0.5px", margin: 0 }}>{shipment.shipmentId}</h1>
            <span style={{ background: sc.bg, color: sc.text, padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: sc.dot, boxShadow: `0 0 6px ${sc.dot}` }} />
              {sc.label}
            </span>
          </div>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>{shipment.origin} → {shipment.destination}</p>
        </div>
        {shipment.status !== "DELIVERED" && (
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowModal(true)} style={{ background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", color: "white", border: "none", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14, boxShadow: "0 4px 15px rgba(59,130,246,0.3)" }}>+ Record Event</button>
            <button onClick={async () => { if (window.confirm("Mark as DELIVERED?")) { const r = await markDelivered(id); setShipment(r.data); } }} style={{ background: "linear-gradient(135deg,#10b981,#059669)", color: "white", border: "none", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14, boxShadow: "0 4px 15px rgba(16,185,129,0.3)" }}>✓ Mark Delivered</button>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        <Card title="Shipment Details">
          {[["Container ID", shipment.containerId], ["Carrier", shipment.carrier], ["Cargo Type", shipment.cargoType], ["Weight", `${(shipment.weightKg || 0).toLocaleString()} kg`], ["Shipper", shipment.shipper], ["Holder", shipment.currentHolder]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize: 13, color: "#64748b" }}>{l}</span>
              <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500, maxWidth: "55%", textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </Card>

        <Card title="ML Delay Risk Score">
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 64, fontWeight: 900, color: riskColor(risk), lineHeight: 1, letterSpacing: "-2px", textShadow: `0 0 30px ${riskColor(risk)}50` }}>{(risk * 100).toFixed(0)}%</div>
            <div style={{ fontSize: 14, color: riskColor(risk), fontWeight: 700, marginTop: 8, letterSpacing: "1px" }}>{risk >= 0.7 ? "HIGH RISK" : risk >= 0.4 ? "MEDIUM RISK" : "LOW RISK"}</div>
            <div style={{ margin: "16px 0", height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${risk * 100}%`, height: "100%", background: riskColor(risk), boxShadow: `0 0 10px ${riskColor(risk)}`, borderRadius: 4, transition: "width 0.8s" }} />
            </div>
            <div style={{ fontSize: 12, color: "#475569" }}>XGBoost ML Model · Updated live</div>
          </div>
        </Card>

        <Card title="Timing">
          {[["Created", shipment.createdAt ? new Date(shipment.createdAt).toLocaleString() : "—"], ["Est. Arrival", shipment.estimatedArrival ? new Date(shipment.estimatedArrival).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"], ["Actual Arrival", shipment.actualArrival ? new Date(shipment.actualArrival).toLocaleString() : "Pending"], ["Events", `${shipment.events?.length || 0} blockchain records`], ["TX History", `${history.length} transactions`]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize: 13, color: "#64748b" }}>{l}</span>
              <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500, textAlign: "right", maxWidth: "55%" }}>{v}</span>
            </div>
          ))}
        </Card>
      </div>

      <Card title={`Event Timeline — ${shipment.events?.length || 0} immutable records on blockchain`}>
        <div style={{ paddingLeft: 20, position: "relative" }}>
          <div style={{ position: "absolute", left: 26, top: 0, bottom: 0, width: 2, background: "linear-gradient(180deg,#3b82f6,rgba(59,130,246,0))" }} />
          {(shipment.events || []).map((ev, i) => {
            const c = EVT_COLORS[ev.eventType] || "#60a5fa";
            const ico = EVT_ICONS[ev.eventType] || EVT_ICONS.STATUS_UPDATED;
            return (
              <div key={ev.eventId} style={{ position: "relative", marginBottom: 16, paddingLeft: 32 }}>
                <div style={{ position: "absolute", left: -6, top: 4, width: 26, height: 26, borderRadius: "50%", background: `rgba(${c === "#60a5fa" ? "96,165,250" : c === "#a78bfa" ? "167,139,250" : c === "#38bdf8" ? "56,189,248" : c === "#f59e0b" ? "245,158,11" : c === "#22c55e" ? "34,197,94" : c === "#4ade80" ? "74,222,128" : c === "#ef4444" ? "239,68,68" : c === "#fb923c" ? "251,146,60" : "96,165,250"},0.2)`, border: `2px solid ${c}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="12" height="12" fill="none" stroke={c} viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d={ico} /></svg>
                </div>
                <div style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: c, fontWeight: 700, fontSize: 13 }}>{ev.eventType.replace(/_/g, " ")}</span>
                    <span style={{ color: "#475569", fontSize: 12 }}>{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ""}</span>
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: 14, marginBottom: 6 }}>{ev.description}</div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>📍 {ev.location}</span>
                    <span style={{ fontSize: 12, color: "#64748b" }}>🏢 {ev.actor}</span>
                    <span style={{ fontSize: 11, color: "#334155", fontFamily: "monospace" }}>TX: {ev.txId}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 32, width: 440, boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>Record Blockchain Event</h2>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 }}>Event Type</label>
            <select value={form.eventType} onChange={e => setForm({ ...form, eventType: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }}>{EVT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 }}>Location</label>
            <input placeholder="e.g. Port of Rotterdam" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }} />
            <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 }}>Description</label>
            <textarea placeholder="What happened?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, height: 80, resize: "vertical", marginBottom: 20 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleEvent} disabled={submitting} style={{ flex: 1, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", color: "white", border: "none", padding: 13, borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>{submitting ? "Writing to blockchain..." : "Submit to Blockchain"}</button>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)", padding: 13, borderRadius: 10, cursor: "pointer", fontSize: 14 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.025) 0%,rgba(255,255,255,0.01) 100%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.3px" }}>{title}</div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}
