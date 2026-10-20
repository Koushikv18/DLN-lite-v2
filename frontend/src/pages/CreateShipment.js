import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createShipment } from "../services/api";

const CARGO_TYPES = ["Electronics", "Textiles", "Food", "Chemicals", "Machinery", "General", "Other"];
const CARRIERS = ["OceanFreight Co", "GlobalShip Ltd", "MarineX", "AquaLine", "SeaRoute Express"];

export default function CreateShipment({ embedded = false, onCreated }) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    containerId: "",
    origin: "",
    destination: "",
    carrier: CARRIERS[0],
    cargoType: CARGO_TYPES[0],
    weightKg: "",
    estimatedArrival: "",
    notes: "",
    contactEmail: "",
  });

  const setField = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async () => {
    const missing = ["containerId", "origin", "destination", "carrier", "cargoType", "weightKg", "estimatedArrival"].filter((field) => !form[field]);
    if (missing.length) {
      setError(`Please complete: ${missing.join(", ")}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await createShipment({ ...form, weightKg: parseFloat(form.weightKg) });
      if (onCreated) {
        await onCreated(response.data);
      }
      navigate(`/shipments/${response.data.shipmentId}`);
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {!embedded ? (
        <button className="cf-muted-link" onClick={() => navigate("/shipments")}>
          <span aria-hidden="true">←</span>
          Back to shipments
        </button>
      ) : null}

      {!embedded ? (
        <div className="cf-page-head">
          <div>
            <p className="cf-page-kicker">Create blockchain record</p>
            <h1 className="cf-page-title">Register a new shipment handoff.</h1>
            <p className="cf-page-copy">
              This form captures the operational metadata that becomes the foundation of the immutable ledger record.
            </p>
          </div>
        </div>
      ) : (
        <div className="portal-section-head">
          <div className="card-header">⊕ Create New Shipment</div>
          <div className="portal-section-copy">
            This writes the operational metadata that becomes the foundation of the immutable ledger record.
          </div>
        </div>
      )}

      <div className="cf-grid-2 portal-embedded-grid" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(280px,0.8fr)" }}>
        <section className="cf-card">
          <div className="cf-card-label">{embedded ? "Shipment details" : "Shipment details"}</div>
          <div className="cf-form-grid">
            <Field label="Container ID">
              <input className="cf-input" value={form.containerId} onChange={setField("containerId")} placeholder="CONT-ABC123" />
            </Field>
            <Field label="Carrier">
              <select className="cf-select" value={form.carrier} onChange={setField("carrier")}>
                {CARRIERS.map((carrier) => <option key={carrier}>{carrier}</option>)}
              </select>
            </Field>
            <Field label="Origin port">
              <input className="cf-input" value={form.origin} onChange={setField("origin")} placeholder="Shanghai, CN" />
            </Field>
            <Field label="Destination port">
              <input className="cf-input" value={form.destination} onChange={setField("destination")} placeholder="Rotterdam, NL" />
            </Field>
            <Field label="Cargo type">
              <select className="cf-select" value={form.cargoType} onChange={setField("cargoType")}>
                {CARGO_TYPES.map((cargoType) => <option key={cargoType}>{cargoType}</option>)}
              </select>
            </Field>
            <Field label="Weight (kg)">
              <input className="cf-input" type="number" value={form.weightKg} onChange={setField("weightKg")} placeholder="12500" />
            </Field>
            <Field label="Estimated arrival">
              <input className="cf-input" type="date" value={form.estimatedArrival} onChange={setField("estimatedArrival")} />
            </Field>
            <Field label="Contact email">
              <input className="cf-input" type="email" value={form.contactEmail} onChange={setField("contactEmail")} placeholder="ops@company.com" />
            </Field>
            <Field label="Notes" full>
              <textarea className="cf-textarea" value={form.notes} onChange={setField("notes")} placeholder="Special handling notes, internal references, customs remarks..." />
            </Field>
          </div>

          {error ? (
            <div className="cf-card-soft" style={{ marginTop: 16, color: "#ff6674", borderColor: "rgba(255,68,85,0.25)" }}>
              {error}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
            <button className="cf-primary-btn" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Writing to blockchain..." : "Create shipment"}
            </button>
            {!embedded ? (
              <button className="cf-secondary-btn" onClick={() => navigate("/shipments")}>
                Cancel
              </button>
            ) : null}
          </div>
        </section>

        <aside className="cf-card">
          <div className="cf-card-label">What this writes</div>
          <div className="cf-timeline">
            <div className="cf-timeline-item">
              <div className="cf-timeline-title">Foundational ledger record</div>
              <div className="cf-timeline-copy">Creates the shipment identity, route and custody baseline shared across participants.</div>
            </div>
            <div className="cf-timeline-item">
              <div className="cf-timeline-title">ML-ready metadata</div>
              <div className="cf-timeline-copy">Feeds the downstream delay prediction and monitoring views with route context.</div>
            </div>
            <div className="cf-timeline-item">
              <div className="cf-timeline-title">Immutable transaction trail</div>
              <div className="cf-timeline-copy">Once submitted, the resulting record becomes the reference point for all later events and verification checks.</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children, full = false }) {
  return (
    <div className="cf-field" style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label>{label}</label>
      {children}
    </div>
  );
}
