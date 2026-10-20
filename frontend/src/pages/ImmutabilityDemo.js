import React, { useEffect, useState } from "react";
import { getShipment, verifyIntegrity } from "../services/api";

export default function ImmutabilityDemo({ embedded = false, shipments = [] }) {
  const [shipmentId, setShipmentId] = useState("SHP-001");
  const [original, setOriginal] = useState(null);
  const [tampered, setTampered] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (!embedded || shipments.length === 0) return;
    const latestShipment = [...shipments]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
    if (latestShipment?.shipmentId && !shipments.some((shipment) => shipment.shipmentId === shipmentId)) {
      setShipmentId(latestShipment.shipmentId);
      return;
    }
    if (latestShipment?.shipmentId && shipmentId === "SHP-001") {
      setShipmentId(latestShipment.shipmentId);
    }
  }, [embedded, shipmentId, shipments]);

  const fetchOriginal = async () => {
    setLoading(true);
    setResult(null);
    try {
      const response = await getShipment(shipmentId);
      const data = response.data;
      setOriginal(data);
      setTampered(JSON.stringify(data, null, 2));
      setStep(2);
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const verifyData = async () => {
    setLoading(true);
    try {
      let claimed;
      try {
        claimed = JSON.parse(tampered);
      } catch (error) {
        alert("Invalid JSON. Fix the edited payload first.");
        setLoading(false);
        return;
      }
      const response = await verifyIntegrity(shipmentId, claimed);
      setResult(response.data);
      setStep(4);
    } catch (error) {
      alert(`Verify error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const injectTamper = () => {
    if (!original) return;
    const tamper = { ...original, carrier: "HACKED_CARRIER", delayRiskScore: 0.01, status: "DELIVERED" };
    setTampered(JSON.stringify(tamper, null, 2));
  };

  return (
    <div>
      {!embedded ? (
        <div className="cf-page-head">
          <div>
            <p className="cf-page-kicker">Integrity verification</p>
            <h1 className="cf-page-title">Show exactly how tampering gets caught.</h1>
            <p className="cf-page-copy">
              This academic demo compares edited payloads against the ledger so the immutability promise becomes visible.
            </p>
          </div>
        </div>
      ) : (
        <div className="portal-feature-head">
          <div>
            <div className="card-header">🔗 Verification</div>
            <div className="portal-section-copy">Compare edited payloads against the ledger so tampering becomes visible.</div>
          </div>
        </div>
      )}

      <div className="cf-grid-3" style={{ marginBottom: 18 }}>
        {["Fetch record", "Edit payload", "Verify", "Result"].map((label, index) => {
          const current = index + 1;
          const active = step === current;
          const done = step > current;
          return (
            <div
              key={label}
              className="cf-card-soft"
              style={{
                color: done ? "#00e676" : active ? "#00d4ff" : "var(--text2)",
                borderColor: active ? "rgba(0,212,255,0.3)" : undefined,
              }}
            >
              {done ? "✓ " : ""}{label}
            </div>
          );
        })}
      </div>

      <div className="cf-grid-2">
        <section className="cf-card">
          <div className="cf-card-label">Verification controls</div>
          <div className="cf-field">
            <label>Shipment ID</label>
            {embedded && shipments.length ? (
              <select className="cf-select" value={shipmentId} onChange={(event) => setShipmentId(event.target.value)}>
                {[...shipments]
                  .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                  .map((shipment) => (
                    <option key={shipment.shipmentId} value={shipment.shipmentId}>
                      {shipment.shipmentId} · {shipment.origin} to {shipment.destination}
                    </option>
                  ))}
              </select>
            ) : (
              <input className="cf-input" value={shipmentId} onChange={(event) => setShipmentId(event.target.value)} />
            )}
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
            <button className="cf-primary-btn" onClick={fetchOriginal}>
              {loading && step === 1 ? "Fetching..." : "Fetch from blockchain"}
            </button>
            <button className="cf-secondary-btn" onClick={injectTamper} disabled={!original}>
              Inject tamper
            </button>
            <button className="cf-secondary-btn" onClick={verifyData} disabled={!original || loading}>
              {loading && step >= 2 ? "Verifying..." : "Verify against ledger"}
            </button>
          </div>
        </section>

        <section className="cf-card">
          <div className="cf-card-label">Payload under test</div>
          <textarea
            className="cf-textarea"
            style={{ minHeight: 320, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
            value={tampered}
            onChange={(event) => setTampered(event.target.value)}
            disabled={!original}
            placeholder="Fetch a record first..."
          />
        </section>
      </div>

      {result ? (
        <section className="cf-card" style={{ marginTop: 18 }}>
          <div className="cf-card-label">Verification result</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 72 }}>{result.integrityPass ? "✅" : "🚨"}</div>
            <h2 style={{ color: result.integrityPass ? "#00e676" : "#ff6674" }}>
              {result.integrityPass ? "Integrity verified" : "Tamper detected"}
            </h2>
            <p className="cf-page-copy">{result.message}</p>
          </div>

          <div className="cf-grid-3" style={{ marginTop: 18 }}>
            <div className="cf-card-soft"><strong>Shipment</strong><div className="cf-timeline-time">{result.shipmentId}</div></div>
            <div className="cf-card-soft"><strong>Verified at</strong><div className="cf-timeline-time">{result.verifiedAt}</div></div>
            <div className="cf-card-soft"><strong>TX ID</strong><div className="cf-timeline-time">{result.txId}</div></div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
