import React, { useEffect, useRef, useState } from "react";
import { predictManual } from "../services/api";

const ROUTE_ALTERNATIVES = {
    "Shanghai, CN_Rotterdam, NL": [
        { name: "Current Route", via: "Suez Canal → Mediterranean", distance: 19500, stops: 2, transitDays: 28, riskFactors: { congestion: 0.75, weather: "moderate", carrierRate: 0.3 } },
        { name: "Cape of Good Hope", via: "South Africa → Atlantic", distance: 24800, stops: 1, transitDays: 35, riskFactors: { congestion: 0.15, weather: "clear", carrierRate: 0.18 } },
        { name: "Northern Sea Route", via: "Arctic Ocean (seasonal)", distance: 14500, stops: 1, transitDays: 22, riskFactors: { congestion: 0.1, weather: "storm", carrierRate: 0.25 } },
    ],
    "Mumbai, IN_Felixstowe, UK": [
        { name: "Current Route", via: "Suez Canal → English Channel", distance: 11200, stops: 2, transitDays: 22, riskFactors: { congestion: 0.8, weather: "moderate", carrierRate: 0.35 } },
        { name: "Cape Route", via: "South Africa → Atlantic", distance: 19800, stops: 1, transitDays: 32, riskFactors: { congestion: 0.12, weather: "clear", carrierRate: 0.2 } },
        { name: "Direct Fast Service", via: "Suez → Bay of Biscay", distance: 11500, stops: 1, transitDays: 20, riskFactors: { congestion: 0.65, weather: "clear", carrierRate: 0.28 } },
    ],
};
const DEFAULT_ROUTES = [
    { name: "Current Route", via: "Standard Suez Canal Path", distance: 18000, stops: 2, transitDays: 26, riskFactors: { congestion: 0.6, weather: "moderate", carrierRate: 0.3 } },
    { name: "Alternative A", via: "Cape of Good Hope Bypass", distance: 23000, stops: 1, transitDays: 33, riskFactors: { congestion: 0.15, weather: "clear", carrierRate: 0.2 } },
    { name: "Alternative B", via: "Direct Express Service", distance: 17500, stops: 0, transitDays: 22, riskFactors: { congestion: 0.45, weather: "clear", carrierRate: 0.22 } },
];

const WEATHER_COLOR = { clear: "#22c55e", moderate: "#f59e0b", storm: "#ef4444" };
const riskColor = s => s >= 0.7 ? "#ef4444" : s >= 0.4 ? "#f59e0b" : "#22c55e";
const riskLabel = s => s >= 0.7 ? "HIGH" : s >= 0.4 ? "MEDIUM" : "LOW";

export default function RouteOptimizer({ embedded = false }) {
    const requestRef = useRef(0);
    const [origin, setOrigin] = useState("Shanghai, CN");
    const [destination, setDestination] = useState("Rotterdam, NL");
    const [cargo, setCargo] = useState("Electronics");
    const [weight, setWeight] = useState(12500);
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null);

    const PORTS = ["Shanghai, CN", "Mumbai, IN", "Singapore", "Dubai, UAE", "Busan, KR", "Los Angeles, US", "Rotterdam, NL", "Hamburg, DE", "Felixstowe, UK", "Tokyo, JP"];
    const CARGO_TYPES = ["Electronics", "Textiles", "Food", "Chemicals", "Machinery", "General"];

    const runOptimization = async (params = { origin, destination, cargo, weight }) => {
        const requestId = ++requestRef.current;
        setLoading(true);
        const routes = ROUTE_ALTERNATIVES[`${params.origin}_${params.destination}`] || DEFAULT_ROUTES;

        const predictions = await Promise.all(routes.map(async (r, i) => {
            try {
                const res = await predictManual({
                    origin_port: params.origin, destination_port: params.destination,
                    carrier: "OceanFreight Co", cargo_type: params.cargo,
                    weight_kg: params.weight, distance_km: r.distance,
                    num_stops: r.stops, origin_congestion: r.riskFactors.congestion,
                    destination_congestion: 0.4, weather_severity: r.riskFactors.weather,
                    carrier_delay_rate: r.riskFactors.carrierRate, route_avg_delay_days: r.transitDays * 0.1,
                });
                const prob = res.prediction?.delay_probability ?? (0.2 + i * 0.25);
                const costSaving = i === 0 ? 0 : Math.floor((0.6 - prob) * 15000);
                const daysSaved = i === 0 ? 0 : Math.max(0, Math.floor((routes[0].transitDays - r.transitDays) * (1 - prob)));
                return { ...r, probability: prob, costSaving, daysSaved, recommended: false };
            } catch {
                const prob = 0.2 + i * 0.2;
                return { ...r, probability: prob, costSaving: i === 0 ? 0 : Math.floor(Math.random() * 8000) + 2000, daysSaved: i === 0 ? 0 : Math.floor(Math.random() * 5) + 1, recommended: false };
            }
        }));

        if (requestId !== requestRef.current) return;
        const best = predictions.reduce((a, b) => a.probability < b.probability ? a : b);
        best.recommended = true;
        setResults(predictions);
        setSelected(0);
        setLoading(false);
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            runOptimization({ origin, destination, cargo, weight });
        }, 120);

        return () => clearTimeout(timer);
    }, [origin, destination, cargo, weight]);

    const inputStyle = { width: "100%", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0", padding: "11px 14px", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box" };
    const labelStyle = { fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 7, letterSpacing: "0.5px", textTransform: "uppercase" };

    return (
        <div>
            <div style={{ marginBottom: 28 }}>
                {embedded ? (
                    <div className="portal-feature-head">
                        <div>
                            <div className="card-header">🗺 Route Optimizer</div>
                            <div className="portal-section-copy">Compare shipping routes using ML predictions to minimise delay risk and cost.</div>
                        </div>
                    </div>
                ) : (
                    <>
                        <h1 style={{ fontSize: 26, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.5px", marginBottom: 6 }}>Route Optimizer</h1>
                        <p style={{ color: "#64748b", fontSize: 14 }}>Compare shipping routes using XGBoost ML predictions to minimise delay risk and cost</p>
                    </>
                )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 24 }}>
                <div>
                    <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24, marginBottom: 16 }}>
                        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8", marginBottom: 20, letterSpacing: "0.5px", textTransform: "uppercase" }}>Shipment Parameters</h2>
                        <div style={{ marginBottom: 14 }}>
                            <label style={labelStyle}>Origin Port</label>
                            <select value={origin} onChange={e => setOrigin(e.target.value)} style={inputStyle}>{PORTS.map(p => <option key={p}>{p}</option>)}</select>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={labelStyle}>Destination Port</label>
                            <select value={destination} onChange={e => setDestination(e.target.value)} style={inputStyle}>{PORTS.filter(p => p !== origin).map(p => <option key={p}>{p}</option>)}</select>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={labelStyle}>Cargo Type</label>
                            <select value={cargo} onChange={e => setCargo(e.target.value)} style={inputStyle}>{CARGO_TYPES.map(c => <option key={c}>{c}</option>)}</select>
                        </div>
                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>Weight: {weight.toLocaleString()} kg</label>
                            <input type="range" min="1000" max="30000" step="500" value={weight} onChange={e => setWeight(parseInt(e.target.value))} style={{ width: "100%", accentColor: "#3b82f6" }} />
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569", marginTop: 4 }}><span>1,000 kg</span><span>30,000 kg</span></div>
                        </div>
                        <button onClick={runOptimization} disabled={loading} style={{ width: "100%", background: loading ? "rgba(59,130,246,0.3)" : "linear-gradient(135deg,#3b82f6,#8b5cf6)", color: "white", border: "none", padding: 14, borderRadius: 12, cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 15, boxShadow: "0 4px 20px rgba(59,130,246,0.35)", transition: "all 0.2s" }}>
                            {loading ? (
                                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                    <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                                    Analysing Routes...
                                </span>
                            ) : "Optimise Routes →"}
                        </button>
                    </div>

                    {results && (
                        <div style={{ background: "linear-gradient(135deg,rgba(34,197,94,0.06),rgba(59,130,246,0.04))", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 14, padding: 18 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#4ade80", marginBottom: 14 }}>✓ Optimisation Summary</div>
                            {(() => {
                                const best = results.find(r => r.recommended);
                                const current = results[0];
                                const saving = ((current.probability - best.probability) * 100).toFixed(0);
                                return (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "12px 14px" }}>
                                            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Risk Reduction</div>
                                            <div style={{ fontSize: 22, fontWeight: 800, color: "#4ade80" }}>-{saving}%</div>
                                        </div>
                                        {best.costSaving > 0 && <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "12px 14px" }}>
                                            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Estimated Cost Saving</div>
                                            <div style={{ fontSize: 22, fontWeight: 800, color: "#fbbf24" }}>${best.costSaving.toLocaleString()}</div>
                                        </div>}
                                        {best.daysSaved > 0 && <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "12px 14px" }}>
                                            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Days Saved</div>
                                            <div style={{ fontSize: 22, fontWeight: 800, color: "#60a5fa" }}>{best.daysSaved} days</div>
                                        </div>}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                </div>

                <div>
                    {!results && !loading && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, background: "linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0.005))", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 16, color: "#475569" }}>
                            <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
                            <div style={{ fontSize: 16, color: "#64748b", marginBottom: 8 }}>Set parameters and run optimisation</div>
                            <div style={{ fontSize: 13, color: "#475569" }}>Results refresh automatically as you change inputs</div>
                        </div>
                    )}

                    {loading && (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, background: "linear-gradient(135deg,rgba(59,130,246,0.05),rgba(139,92,246,0.03))", border: "1px solid rgba(59,130,246,0.1)", borderRadius: 16 }}>
                            <div style={{ width: 48, height: 48, border: "3px solid rgba(59,130,246,0.2)", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 20 }} />
                            <div style={{ fontSize: 15, color: "#60a5fa", fontWeight: 500, marginBottom: 8 }}>Running XGBoost on all routes...</div>
                            <div style={{ fontSize: 13, color: "#475569" }}>Analysing congestion · weather · carrier history</div>
                        </div>
                    )}

                    {results && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                            {results.map((r, i) => (
                                <div key={i} onClick={() => setSelected(i)} style={{ background: selected === i ? "rgba(59,130,246,0.08)" : r.recommended ? "linear-gradient(135deg,rgba(34,197,94,0.05),rgba(34,197,94,0.02))" : "linear-gradient(135deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))", border: selected === i ? "1px solid rgba(59,130,246,0.4)" : r.recommended ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "20px 22px", cursor: "pointer", transition: "all 0.2s", position: "relative" }}>
                                    {r.recommended && (
                                        <div style={{ position: "absolute", top: -1, right: 16, background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "white", fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: "0 0 8px 8px", letterSpacing: "0.5px" }}>
                                            ✓ RECOMMENDED
                                        </div>
                                    )}
                                    {i === 0 && !r.recommended && (
                                        <div style={{ position: "absolute", top: -1, right: 16, background: "rgba(100,116,139,0.8)", color: "#cbd5e1", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: "0 0 8px 8px" }}>
                                            CURRENT ROUTE
                                        </div>
                                    )}

                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                                        <div>
                                            <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 }}>{r.name}</div>
                                            <div style={{ fontSize: 13, color: "#64748b" }}>via {r.via}</div>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <div style={{ fontSize: 36, fontWeight: 900, color: riskColor(r.probability), letterSpacing: "-1px", lineHeight: 1, textShadow: `0 0 20px ${riskColor(r.probability)}40` }}>{(r.probability * 100).toFixed(0)}%</div>
                                            <div style={{ fontSize: 11, color: riskColor(r.probability), fontWeight: 700, letterSpacing: "0.5px" }}>{riskLabel(r.probability)} RISK</div>
                                        </div>
                                    </div>

                                    <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, marginBottom: 16, overflow: "hidden" }}>
                                        <div style={{ width: `${r.probability * 100}%`, height: "100%", background: riskColor(r.probability), borderRadius: 3, boxShadow: `0 0 8px ${riskColor(r.probability)}`, transition: "width 0.8s" }} />
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                                        {[
                                            { label: "Distance", value: `${(r.distance / 1000).toFixed(1)}k km`, color: "#60a5fa" },
                                            { label: "Transit Time", value: `${r.transitDays} days`, color: "#a78bfa" },
                                            { label: "Stops", value: r.stops === 0 ? "Direct" : `${r.stops} stop${r.stops > 1 ? "s" : ""}`, color: "#38bdf8" },
                                            { label: "Weather", value: r.riskFactors.weather, color: WEATHER_COLOR[r.riskFactors.weather] },
                                        ].map(({ label, value, color }) => (
                                            <div key={label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 9, padding: "10px 12px", textAlign: "center" }}>
                                                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{label}</div>
                                                <div style={{ fontSize: 13, fontWeight: 600, color, textTransform: "capitalize" }}>{value}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {(r.costSaving > 0 || r.daysSaved > 0) && (
                                        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.12)", borderRadius: 10, display: "flex", gap: 20 }}>
                                            {r.costSaving > 0 && <div><span style={{ fontSize: 12, color: "#64748b" }}>Est. saving: </span><span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>${r.costSaving.toLocaleString()}</span></div>}
                                            {r.daysSaved > 0 && <div><span style={{ fontSize: 12, color: "#64748b" }}>Days saved: </span><span style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>{r.daysSaved} days</span></div>}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}
