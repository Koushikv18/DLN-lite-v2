import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import ExactPortalFrame from "./components/ExactPortalFrame";
import Dashboard from "./pages/Dashboard";
import ShipmentList from "./pages/ShipmentList";
import ShipmentDetail from "./pages/ShipmentDetail";
import CreateShipment from "./pages/CreateShipment";
import Analytics from "./pages/Analytics";
import RiskPredictor from "./pages/RiskPredictor";
import ImmutabilityDemo from "./pages/ImmutabilityDemo";
import DisruptionFeed from "./pages/DisruptionFeed";
import RouteOptimizer from "./pages/RouteOptimizer";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ExactPortalFrame />} />
        <Route path="/" element={<Layout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="shipments" element={<ShipmentList />} />
          <Route path="shipments/new" element={<CreateShipment />} />
          <Route path="shipments/:id" element={<ShipmentDetail />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="risk-predictor" element={<RiskPredictor />} />
          <Route path="immutability-demo" element={<ImmutabilityDemo />} />
          <Route path="disruptions" element={<DisruptionFeed />} />
          <Route path="route-optimizer" element={<RouteOptimizer />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
