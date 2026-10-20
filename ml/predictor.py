# ─────────────────────────────────────────────────────────────────────────────
# predictor.py
# Core prediction logic. Loads the XGBoost model and runs inference.
# ─────────────────────────────────────────────────────────────────────────────

import os
import joblib
import numpy as np
import pandas as pd

from utils import encode_features

# Risk thresholds
LOW_RISK    = 0.40
HIGH_RISK   = 0.70

# Feature columns the model was trained on (must match training exactly)
FEATURE_COLUMNS = [
    "distance_km",
    "num_stops",
    "weight_kg",
    "month",
    "origin_congestion",
    "destination_congestion",
    "weather_severity_encoded",   # 0=clear, 1=moderate, 2=storm
    "carrier_delay_rate",
    "route_avg_delay_days",
    "cargo_type_encoded",
    "origin_port_encoded",
    "destination_port_encoded",
    "carrier_encoded",
]


class DelayPredictor:
    """
    Wraps the trained XGBoost model.
    Handles feature encoding, prediction, and result formatting.
    """

    def __init__(self, model_path: str):
        self.model = None
        self.encoders = {}
        self._load_model(model_path)

    def _load_model(self, model_path: str):
        """Load model from disk. If not found, warn — training script must be run first."""
        if os.path.exists(model_path):
            saved = joblib.load(model_path)
            self.model    = saved["model"]
            self.encoders = saved.get("encoders", {})
            print(f"[OK] Model loaded from {model_path}")
        else:
            print(f"[WARN] Model not found at {model_path}. Run train_model.py first.")

    # ─────────────────────────────────────────────────────────────────────────
    # predict_single
    # ─────────────────────────────────────────────────────────────────────────

    def predict_single(self, features: dict) -> dict:
        """
        Run prediction for a single shipment.

        Returns:
            {
                delay_probability: float (0–1),
                risk_level: "LOW" | "MEDIUM" | "HIGH",
                top_factors: [...],
                predicted_delay_days: float
            }
        """
        if self.model is None:
            raise RuntimeError("Model not loaded. Run train_model.py first.")

        # Encode raw features into the numeric format the model expects
        encoded = encode_features(features, self.encoders)

        # Build DataFrame with correct column order
        X = pd.DataFrame([encoded], columns=FEATURE_COLUMNS)

        # Get probability of delay (class 1 = delayed)
        prob = float(self.model.predict_proba(X)[0][1])

        # Risk level label
        if prob < LOW_RISK:
            risk_level = "LOW"
        elif prob < HIGH_RISK:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"

        # Feature importance — which factors drove this prediction
        top_factors = self._get_top_factors(X)

        # Rough delay estimate (heuristic, not a separate regressor)
        predicted_delay_days = 0.0
        if prob >= LOW_RISK:
            predicted_delay_days = round(prob * features.get("route_avg_delay_days", 3) * 2, 1)

        return {
            "delay_probability": round(prob, 4),
            "risk_level":        risk_level,
            "top_factors":       top_factors,
            "predicted_delay_days": predicted_delay_days,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # predict_batch
    # ─────────────────────────────────────────────────────────────────────────

    def predict_batch(self, shipments: list) -> list:
        """Run prediction for a list of shipment feature dicts."""
        results = []
        for shipment in shipments:
            try:
                prediction = self.predict_single(shipment)
                prediction["shipmentId"] = shipment.get("shipmentId", "unknown")
                results.append(prediction)
            except Exception as e:
                results.append({
                    "shipmentId":       shipment.get("shipmentId", "unknown"),
                    "delay_probability": 0.5,
                    "risk_level":       "UNKNOWN",
                    "error":            str(e),
                })
        return results

    # ─────────────────────────────────────────────────────────────────────────
    # _get_top_factors
    # ─────────────────────────────────────────────────────────────────────────

    def _get_top_factors(self, X: pd.DataFrame) -> list:
        """
        Returns the top 3 features driving this prediction,
        using the model's feature importances.
        """
        importances = self.model.feature_importances_
        feature_names = FEATURE_COLUMNS

        # Pair each feature with its importance score
        pairs = sorted(
            zip(feature_names, importances),
            key=lambda x: x[1],
            reverse=True
        )

        # Human-readable labels
        label_map = {
            "origin_congestion":        "Origin port congestion",
            "destination_congestion":   "Destination port congestion",
            "weather_severity_encoded": "Weather conditions",
            "carrier_delay_rate":       "Carrier historical delay rate",
            "route_avg_delay_days":     "Route average delay history",
            "distance_km":              "Route distance",
            "num_stops":                "Number of transit stops",
            "month":                    "Season / time of year",
            "weight_kg":                "Cargo weight",
            "cargo_type_encoded":       "Cargo type",
            "origin_port_encoded":      "Origin port",
            "destination_port_encoded": "Destination port",
            "carrier_encoded":          "Carrier",
        }

        top = []
        for feature, importance in pairs[:3]:
            top.append({
                "factor":     label_map.get(feature, feature),
                "importance": round(float(importance), 4),
            })

        return top
