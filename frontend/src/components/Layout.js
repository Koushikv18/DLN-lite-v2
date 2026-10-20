import React from "react";
import { NavLink, Outlet } from "react-router-dom";

const NAV = [
  { to: "/dashboard", label: "Overview" },
  { to: "/shipments", label: "Shipments" },
  { to: "/shipments/new", label: "Create" },
  { to: "/analytics", label: "Analytics" },
  { to: "/risk-predictor", label: "Risk" },
  { to: "/disruptions", label: "Disruptions" },
  { to: "/route-optimizer", label: "Routing" },
  { to: "/immutability-demo", label: "Verification" },
];

export default function Layout() {
  return (
    <div className="cf-app-shell">
      <header className="cf-topbar">
        <div className="cf-logo">
          <div className="cf-logo-icon" aria-hidden="true">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="cf-logo-text">
            <div className="cf-logo-title">Cargo Intel / DLN-Lite</div>
            <div className="cf-logo-subtitle">Blockchain logistics command platform</div>
          </div>
        </div>

        <div className="cf-topbar-right">
          <div className="cf-live-badge">
            <span className="cf-dot" />
            Live network telemetry
          </div>
          <div className="cf-user-badge">
            <span className="cf-user-dot" />
            <span>
              Signed in as <strong>Operations</strong>
            </span>
          </div>
        </div>
      </header>

      <div className="cf-nav-wrap">
        <nav className="cf-nav" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/dashboard"}
              className={({ isActive }) => `cf-nav-link${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="cf-content">
        <Outlet />
      </main>
    </div>
  );
}
