import React from "react";

export default function ExactPortalFrame() {
  const configuredApiBase = (process.env.REACT_APP_API_URL || "").trim();
  const normalizedApiBase = configuredApiBase
    ? (configuredApiBase.endsWith("/api")
        ? configuredApiBase
        : `${configuredApiBase.replace(/\/+$/, "")}/api`)
    : "";
  const iframeSrc = configuredApiBase
    ? `/logistics_blockchain_3d.html?apiBase=${encodeURIComponent(normalizedApiBase)}`
    : "/logistics_blockchain_3d.html";

  return (
    <iframe
      title="Exact Logistics Portal"
      src={iframeSrc}
      style={{
        width: "100%",
        height: "100vh",
        border: "0",
        display: "block",
        background: "#04091a",
      }}
    />
  );
}
