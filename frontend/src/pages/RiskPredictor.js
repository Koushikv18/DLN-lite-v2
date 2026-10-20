import React, { useEffect, useRef, useState } from "react";
import { predictManual } from "../services/api";

const riskColor = (score) => (score >= 0.7 ? "#ff6674" : score >= 0.4 ? "#f5a623" : "#00e676");
const riskLabel = (score) => (score >= 0.7 ? "High risk" : score >= 0.4 ? "Medium risk" : "Low risk");

export default function RiskPredictor({ embedded = false }) {
  const requestRef = useRef(0);
  const [form, setForm] = useState({
    origin_port: "Shanghai",
    destination_port: "Rotterdam",
    carrier: "OceanFreight Co",
    cargo_type: "Electronics",
    weight_kg: 12500,
    distance_km: 19000,
    num_stops: 1,
    origin_congestion: 0.5,
    destination_congestion: 0.5,
    weather_severity: "clear",
    carrier_delay_rate: 0.2,
    route_avg_delay_days: 3,
  });

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const setField = (field) => (event) => {
    const value = event.target.type === "number" ? parseFloat(event.target.value) : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handlePredict = async (nextForm = form) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await predictManual(nextForm);
      if (requestId !== requestRef.current) return;
      setResult(response.prediction || null);
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      setError(requestError.response?.data?.error || requestError.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => handlePredict(form), 120);
    return () => clearTimeout(timer);
  }, [form]);

  return (
    <div>
      {!embedded ? (
        <div className="cf-page-head">
          <div>
            <p className="cf-page-kicker">Predictive intelligence</p>
            <h1 className="cf-page-title">Model delay probability before disruption hits.</h1>
            <p className="cf-page-copy">Tune route conditions live and watch the risk score update as the model reacts.</p>
          </div>
        </div>
      ) : (
        <div className="portal-feature-head">
          <div>
            <div className="card-header">🤖 Risk Predictor</div>
            <div className="portal-section-copy">Tune route conditions live and watch the ML score update as the model reacts.</div>
          </div>
        </div>
      )}

      <div className="cf-grid-2">
        <section className="cf-card">
          <div className="cf-card-label">Shipment parameters</div>
          <div className="cf-form-grid">
            <Field label="Origin port"><input className="cf-input" value={form.origin_port} onChange={setField("origin_port")} /></Field>
            <Field label="Destination port"><input className="cf-input" value={form.destination_port} onChange={setField("destination_port")} /></Field>
            <Field label="Carrier"><input className="cf-input" value={form.carrier} onChange={setField("carrier")} /></Field>
            <Field label="Weather">
              <select className="cf-select" value={form.weather_severity} onChange={setField("weather_severity")}>
                <option value="clear">Clear</option>
                <option value="moderate">Moderate</option>
                <option value="storm">Storm</option>
              </select>
            </Field>
            <Field label="Distance (km)"><input className="cf-input" type="number" value={form.distance_km} onChange={setField("distance_km")} /></Field>
            <Field label="Stops"><input className="cf-input" type="number" value={form.num_stops} onChange={setField("num_stops")} /></Field>
            <Field label="Weight (kg)"><input className="cf-input" type="number" value={form.weight_kg} onChange={setField("weight_kg")} /></Field>
            <Field label="Carrier delay rate"><input className="cf-input" type="number" step="0.01" value={form.carrier_delay_rate} onChange={setField("carrier_delay_rate")} /></Field>
          </div>

          <div style={{ marginTop: 16 }}>
            <Slider label={`Origin congestion ${Math.round(form.origin_congestion * 100)}%`} value={form.origin_congestion} onChange={setField("origin_congestion")} />
            <Slider label={`Destination congestion ${Math.round(form.destination_congestion * 100)}%`} value={form.destination_congestion} onChange={setField("destination_congestion")} />
            <Slider
              label={`Route average delay ${form.route_avg_delay_days} days`}
              value={form.route_avg_delay_days / 14}
              onChange={(event) => setForm((current) => ({ ...current, route_avg_delay_days: parseFloat((event.target.value * 14).toFixed(1)) }))}
            />
          </div>

          {error ? <div className="cf-card-soft" style={{ color: "#ff6674", marginTop: 14 }}>{error}</div> : null}
          <button className="cf-primary-btn" style={{ marginTop: 18 }} onClick={() => handlePredict()}>
            {loading ? "Running model..." : "Predict delay risk"}
          </button>
        </section>

        <section className="cf-card">
          <div className="cf-card-label">Prediction result</div>
          {!result ? (
            <div className="cf-empty">Prediction updates automatically as inputs change.</div>
          ) : (
            <div>
              <div style={{ textAlign: "center", marginBottom: 22 }}>
                <div style={{ fontSize: 78, lineHeight: 1, fontWeight: 900, color: riskColor(result.delay_probability) }}>
                  {Math.round(result.delay_probability * 100)}%
                </div>
                <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800, color: riskColor(result.delay_probability) }}>
                  {riskLabel(result.delay_probability)}
                </div>
                {result.predicted_delay_days > 0 ? (
                  <div className="cf-page-copy">Estimated delay window: about {result.predicted_delay_days} days</div>
                ) : null}
              </div>

              <div className="cf-card-soft" style={{ marginBottom: 16 }}>
                <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{ width: `${result.delay_probability * 100}%`, height: "100%", background: riskColor(result.delay_probability) }} />
                </div>
              </div>

              <div className="cf-card-label">Top factors</div>
              <div className="cf-timeline">
                {(result.top_factors || []).map((factor) => (
                  <div key={factor.factor} className="cf-timeline-item">
                    <div className="cf-timeline-title">{factor.factor}</div>
                    <div className="cf-timeline-time">Influence {(factor.importance * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="cf-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function Slider({ label, value, onChange }) {
  return (
    <div className="cf-field" style={{ marginBottom: 12 }}>
      <label>{label}</label>
      <input type="range" min="0" max="1" step="0.01" value={value} onChange={onChange} style={{ accentColor: "#00d4ff" }} />
    </div>
  );
}
