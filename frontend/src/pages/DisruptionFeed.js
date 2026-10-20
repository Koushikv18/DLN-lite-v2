import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getAllShipments } from "../services/api";

const DISRUPTION_TEMPLATES = [
    { type: "WEATHER", color: "#f59e0b", dot: "#f59e0b", icon: "M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z", severity: "HIGH", titles: ["Tropical Storm Warning", "Heavy Fog Advisory", "Cyclone Alert", "Monsoon Disruption"], locations: ["South China Sea", "Bay of Bengal", "Gulf of Aden", "North Atlantic", "Strait of Malacca"] },
    { type: "PORT", color: "#ef4444", dot: "#ef4444", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 8h10v-5a1 1 0 00-1-1H10a1 1 0 00-1 1v5z", severity: "CRITICAL", titles: ["Port Congestion Critical", "Dock Worker Strike", "Terminal Equipment Failure", "Berth Shortage"], locations: ["Port of Rotterdam", "Shanghai Port", "Port of LA", "Singapore Terminal", "Busan Container Terminal"] },
    { type: "CUSTOMS", color: "#a78bfa", dot: "#a78bfa", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", severity: "MEDIUM", titles: ["Customs System Outage", "Regulatory Inspection Wave", "New Trade Compliance Rules", "Documentation Backlog"], locations: ["UK Border Force", "EU Customs Authority", "US CBP", "Singapore Customs", "Dubai Ports"] },
    { type: "ROUTE", color: "#38bdf8", dot: "#38bdf8", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7", severity: "HIGH", titles: ["Suez Canal Partial Closure", "Panama Canal Draft Restrictions", "Piracy Alert Issued", "Geopolitical Route Restriction"], locations: ["Suez Canal", "Panama Canal", "Horn of Africa", "Red Sea Corridor", "Strait of Hormuz"] },
    { type: "CAPACITY", color: "#34d399", dot: "#34d399", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4", severity: "LOW", titles: ["Container Shortage Alert", "Rate Surge Detected", "Vessel Capacity Crunch", "Equipment Imbalance"], locations: ["Asia-Europe Lane", "Trans-Pacific Route", "Intra-Asia Network", "Americas Service"] },
];

const SEVERITY_CONFIG = {
    CRITICAL: { bg: "rgba(239,68,68,0.12)", text: "#f87171", border: "rgba(239,68,68,0.3)" },
    HIGH: { bg: "rgba(245,158,11,0.12)", text: "#fbbf24", border: "rgba(245,158,11,0.3)" },
    MEDIUM: { bg: "rgba(167,139,250,0.12)", text: "#a78bfa", border: "rgba(139,92,246,0.3)" },
    LOW: { bg: "rgba(52,211,153,0.12)", text: "#34d399", border: "rgba(52,211,153,0.3)" },
};

function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function generateDisruption(id) {
    const t = randomItem(DISRUPTION_TEMPLATES);
    const delayDays = t.severity === "CRITICAL" ? Math.floor(Math.random() * 8) + 5 : t.severity === "HIGH" ? Math.floor(Math.random() * 5) + 2 : Math.floor(Math.random() * 3) + 1;
    const affectedVessels = Math.floor(Math.random() * 120) + 10;
    return {
        id, type: t.type, color: t.color, dot: t.dot, icon: t.icon, severity: t.severity,
        title: randomItem(t.titles), location: randomItem(t.locations),
        timestamp: new Date(),
        delayDays, affectedVessels,
        riskIncrease: t.severity === "CRITICAL" ? Math.floor(Math.random() * 30) + 20 : t.severity === "HIGH" ? Math.floor(Math.random() * 20) + 10 : Math.floor(Math.random() * 10) + 5,
        resolved: false,
        description: `${t.severity === "CRITICAL" ? "Critical disruption" : t.severity === "HIGH" ? "Major disruption" : "Moderate disruption"} detected affecting shipping operations. Estimated impact: +${delayDays} days delay for ${affectedVessels} vessels.`,
    };
}

export default function DisruptionFeed({ embedded = false }) {
    const [disruptions, setDisruptions] = useState(() => Array.from({ length: 6 }, (_, i) => generateDisruption(i)));
    const [shipments, setShipments] = useState([]);
    const [paused, setPaused] = useState(false);
    const [stats, setStats] = useState({ total: 6, critical: 0, resolved: 0, avgDelay: 0 });
    const counterRef = useRef(6);
    const navigate = useNavigate();

    useEffect(() => { getAllShipments().then(r => setShipments(r.data || [])).catch(() => { }); }, []);

    useEffect(() => {
        if (paused) return;
        const interval = setInterval(() => {
            const newD = generateDisruption(counterRef.current++);
            setDisruptions(prev => {
                const updated = [newD, ...prev].slice(0, 20);
                const critical = updated.filter(d => d.severity === "CRITICAL" && !d.resolved).length;
                const resolved = updated.filter(d => d.resolved).length;
                const avgDelay = Math.round(updated.reduce((s, d) => s + d.delayDays, 0) / updated.length);
                setStats({ total: updated.length, critical, resolved, avgDelay });
                return updated;
            });
        }, 8000);
        return () => clearInterval(interval);
    }, [paused]);

    useEffect(() => {
        const resolveInterval = setInterval(() => {
            setDisruptions(prev => prev.map(d => (!d.resolved && Math.random() < 0.15) ? { ...d, resolved: true } : d));
        }, 12000);
        return () => clearInterval(resolveInterval);
    }, []);

    useEffect(() => {
        const c = disruptions.filter(d => d.severity === "CRITICAL" && !d.resolved).length;
        const r = disruptions.filter(d => d.resolved).length;
        const avg = Math.round(disruptions.reduce((s, d) => s + d.delayDays, 0) / Math.max(disruptions.length, 1));
        setStats({ total: disruptions.length, critical: c, resolved: r, avgDelay: avg });
    }, [disruptions]);

    const affectedShipments = shipments.filter(s => s.status !== "DELIVERED" && (s.delayRiskScore || 0) >= 0.5);

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                        {embedded ? (
                            <div className="card-header">🌪 Disruption Feed</div>
                        ) : (
                            <h1 style={{ fontSize: 26, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.5px", margin: 0 }}>Live Disruption Feed</h1>
                        )}
                        {!paused && <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 20, padding: "4px 12px" }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite" }} />
                            <span style={{ fontSize: 12, color: "#f87171", fontWeight: 600 }}>LIVE</span>
                        </div>}
                    </div>
                    <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>Real-time global shipping disruption monitoring · Updates every 8 seconds</p>
                </div>
                <button onClick={() => setPaused(!paused)} style={{ background: paused ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: paused ? "white" : "#94a3b8", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                    {paused ? "▶ Resume Feed" : "⏸ Pause Feed"}
                </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
                {[
                    { label: "Active Disruptions", value: stats.total - stats.resolved, color: "#f87171", glow: "rgba(239,68,68,0.3)" },
                    { label: "Critical Alerts", value: stats.critical, color: "#ef4444", glow: "rgba(239,68,68,0.4)" },
                    { label: "Resolved Today", value: stats.resolved, color: "#4ade80", glow: "rgba(34,197,94,0.3)" },
                    { label: "Avg Delay Impact", value: `+${stats.avgDelay}d`, color: "#fbbf24", glow: "rgba(245,158,11,0.3)" },
                ].map(({ label, value, color, glow }) => (
                    <div key={label} style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", top: -15, right: -15, width: 60, height: 60, borderRadius: "50%", background: glow, filter: "blur(25px)" }} />
                        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, fontWeight: 500 }}>{label}</div>
                        <div style={{ fontSize: 34, fontWeight: 800, color, letterSpacing: "-1px" }}>{value}</div>
                    </div>
                ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", margin: 0 }}>Disruption Events</h2>
                        <span style={{ fontSize: 12, color: "#475569" }}>{disruptions.length} events tracked</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "calc(100vh - 340px)", overflowY: "auto", paddingRight: 4 }}>
                        {disruptions.map((d) => {
                            const sc = SEVERITY_CONFIG[d.severity];
                            const age = Math.floor((new Date() - d.timestamp) / 60000);
                            return (
                                <div key={d.id} style={{ background: d.resolved ? "rgba(255,255,255,0.01)" : "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: `1px solid ${d.resolved ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)"}`, borderLeft: `3px solid ${d.resolved ? "#334155" : d.color}`, borderRadius: 12, padding: "16px 18px", opacity: d.resolved ? 0.5 : 1, transition: "all 0.4s" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div style={{ width: 32, height: 32, borderRadius: 8, background: `rgba(${d.color === "#f59e0b" ? "245,158,11" : d.color === "#ef4444" ? "239,68,68" : d.color === "#a78bfa" ? "167,139,250" : d.color === "#38bdf8" ? "56,189,248" : "52,211,153"},0.15)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                                <svg width="15" height="15" fill="none" stroke={d.color} viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={d.icon} /></svg>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 14, fontWeight: 600, color: d.resolved ? "#475569" : "#f1f5f9" }}>{d.title}</div>
                                                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>📍 {d.location}</div>
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                            {d.resolved
                                                ? <span style={{ background: "rgba(34,197,94,0.1)", color: "#4ade80", fontSize: 11, padding: "3px 9px", borderRadius: 20, border: "1px solid rgba(34,197,94,0.2)", fontWeight: 600 }}>RESOLVED</span>
                                                : <span style={{ background: sc.bg, color: sc.text, fontSize: 11, padding: "3px 9px", borderRadius: 20, border: `1px solid ${sc.border}`, fontWeight: 600 }}>{d.severity}</span>
                                            }
                                            <span style={{ fontSize: 11, color: "#475569" }}>{age < 1 ? "just now" : `${age}m ago`}</span>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>{d.description}</div>
                                    <div style={{ display: "flex", gap: 16 }}>
                                        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "7px 12px", flex: 1, textAlign: "center" }}>
                                            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>Delay Impact</div>
                                            <div style={{ fontSize: 16, fontWeight: 700, color: "#fbbf24" }}>+{d.delayDays} days</div>
                                        </div>
                                        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "7px 12px", flex: 1, textAlign: "center" }}>
                                            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>Vessels Affected</div>
                                            <div style={{ fontSize: 16, fontWeight: 700, color: "#60a5fa" }}>{d.affectedVessels}</div>
                                        </div>
                                        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "7px 12px", flex: 1, textAlign: "center" }}>
                                            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>Risk Increase</div>
                                            <div style={{ fontSize: 16, fontWeight: 700, color: "#f87171" }}>+{d.riskIncrease}%</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
                        <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>
                            ⚠️ At-Risk Shipments
                        </div>
                        <div style={{ padding: 12 }}>
                            {affectedShipments.length === 0
                                ? <div style={{ padding: 20, textAlign: "center", color: "#475569", fontSize: 13 }}>No high-risk shipments</div>
                                : affectedShipments.slice(0, 6).map(s => (
                                    <div key={s.shipmentId} onClick={() => navigate(`/shipments/${s.shipmentId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 8px", borderRadius: 8, cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background 0.1s" }}
                                        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: "#60a5fa" }}>{s.shipmentId}</div>
                                            <div style={{ fontSize: 11, color: "#64748b" }}>{s.origin?.split(",")[0]} → {s.destination?.split(",")[0]}</div>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <div style={{ fontSize: 14, fontWeight: 700, color: s.delayRiskScore >= 0.7 ? "#ef4444" : "#f59e0b" }}>{((s.delayRiskScore || 0) * 100).toFixed(0)}%</div>
                                            <div style={{ fontSize: 10, color: s.delayRiskScore >= 0.7 ? "#ef4444" : "#f59e0b", fontWeight: 600 }}>{s.delayRiskScore >= 0.7 ? "HIGH" : "MEDIUM"}</div>
                                        </div>
                                    </div>
                                ))
                            }
                        </div>
                    </div>

                    <div style={{ background: "linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.04))", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 14, padding: 18 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#60a5fa", marginBottom: 12 }}>🌍 Route Status Map</div>
                        {[
                            { route: "Asia → Europe", status: "DISRUPTED", color: "#ef4444", delay: "+4.2d avg" },
                            { route: "Trans-Pacific", status: "NORMAL", color: "#22c55e", delay: "On schedule" },
                            { route: "Middle East → EU", status: "CAUTION", color: "#f59e0b", delay: "+1.8d avg" },
                            { route: "Americas", status: "NORMAL", color: "#22c55e", delay: "On schedule" },
                            { route: "Intra-Asia", status: "CAUTION", color: "#f59e0b", delay: "+0.9d avg" },
                        ].map(({ route, status, color, delay }) => (
                            <div key={route} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 5px ${color}` }} />
                                    <span style={{ fontSize: 13, color: "#cbd5e1" }}>{route}</span>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color }}>{status}</div>
                                    <div style={{ fontSize: 11, color: "#64748b" }}>{delay}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
        </div>
    );
}
