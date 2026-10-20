import React, { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getRiskDistribution, getSummary, getTopRoutes, runBatchUpdate } from "../services/api";

export default function Analytics({ embedded = false }) {
  const [summary, setSummary] = useState(null);
  const [riskDist, setRiskDist] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadAnalytics = async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      setError(null);
      await runBatchUpdate().catch(() => null);
      const [summaryRes, riskRes, routeRes] = await Promise.all([getSummary(), getRiskDistribution(), getTopRoutes()]);
      setSummary(summaryRes.data);
      setRiskDist(riskRes.data);
      setRoutes(routeRes.data || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics(true);
    const interval = setInterval(() => loadAnalytics(false), 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="cf-page-shell">
        <p className="cf-microcopy">Telemetry aggregation</p>
        <h1>Refreshing analytics...</h1>
      </div>
    );
  }

  if (error || !summary || !riskDist) {
    return (
      <div className="cf-page-shell">
        <h1>Analytics unavailable</h1>
        <p className="cf-page-copy">The backend could not provide analytics data just now.</p>
      </div>
    );
  }

  const statusData = [
    { name: "In Transit", value: summary.inTransit || 0, color: "#2080ff" },
    { name: "Delivered", value: summary.delivered || 0, color: "#00e676" },
    { name: "Delayed", value: summary.delayed || 0, color: "#ff6674" },
    { name: "Other", value: Math.max(0, (summary.total || 0) - (summary.inTransit || 0) - (summary.delivered || 0) - (summary.delayed || 0)), color: "#8b98b5" },
  ].filter((item) => item.value > 0);

  const riskData = [
    { name: "Low", value: riskDist.low || 0, fill: "#00e676" },
    { name: "Medium", value: riskDist.medium || 0, fill: "#f5a623" },
    { name: "High", value: riskDist.high || 0, fill: "#ff6674" },
  ];

  return (
    <div>
      {!embedded ? (
        <div className="cf-page-head">
          <div>
            <p className="cf-page-kicker">Network analytics</p>
            <h1 className="cf-page-title">See performance, congestion and risk in one layer.</h1>
            <p className="cf-page-copy">Live operational charts refresh against the current ledger and prediction services.</p>
          </div>
          <button className="cf-primary-btn" onClick={() => loadAnalytics(true)}>
            Refresh analytics
          </button>
        </div>
      ) : (
        <div className="portal-feature-head">
          <div>
            <div className="card-header">📊 Analyst View</div>
            <div className="portal-section-copy">Live operational charts refresh against the current ledger and prediction services.</div>
          </div>
          <button className="cf-primary-btn portal-inline-button" onClick={() => loadAnalytics(true)}>
            Refresh analytics
          </button>
        </div>
      )}

      <section className="cf-grid-3" style={{ marginBottom: 18 }}>
        <Kpi label="On-time rate" value={`${(((summary.onTimeRate) || 0) * 100).toFixed(1)}%`} color="#00e676" />
        <Kpi label="Average risk" value={`${(((summary.avgRiskScore) || 0) * 100).toFixed(1)}%`} color="#f5a623" />
        <Kpi label="High risk now" value={summary.highRisk || 0} color="#ff6674" />
      </section>

      <section className="cf-grid-2" style={{ marginBottom: 18 }}>
        <ChartCard title="Shipment status distribution">
          {statusData.length === 0 ? (
            <div className="cf-empty">No shipment data yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" outerRadius={88} dataKey="value" labelLine={false}>
                  {statusData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#0c1530", border: "1px solid rgba(100,160,255,0.2)", borderRadius: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="ML risk distribution">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={riskData} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: "#8b98b5", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8b98b5", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0c1530", border: "1px solid rgba(100,160,255,0.2)", borderRadius: 12 }} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {riskData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      <ChartCard title="Top shipping routes">
        {routes.length === 0 ? (
          <div className="cf-empty">No route data yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(240, routes.length * 48)}>
            <BarChart data={routes} layout="vertical" margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: "#8b98b5", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="route" width={220} tick={{ fill: "#e8edf5", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0c1530", border: "1px solid rgba(100,160,255,0.2)", borderRadius: 12 }} />
              <Bar dataKey="count" fill="#00d4ff" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div className="cf-kpi">
      <div className="cf-kpi-label">{label}</div>
      <div className="cf-kpi-value" style={{ color }}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <section className="cf-card">
      <div className="cf-card-header">
        <h2 className="cf-card-title">{title}</h2>
      </div>
      {children}
    </section>
  );
}
