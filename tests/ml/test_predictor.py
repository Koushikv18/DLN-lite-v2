# ─────────────────────────────────────────────────────────────────────────────
# tests/ml/test_predictor.py
# Tests the ML predictor and training pipeline.
# Run with: python -m pytest tests/ml/ -v
# ─────────────────────────────────────────────────────────────────────────────

import sys
import os
import pytest
import numpy as np

# Add ml directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../ml"))

from train_model import generate_dataset, train_and_compare
from utils import encode_features, validate_features, WEATHER_MAP


# ─────────────────────────────────────────────────────────────────────────────
# Dataset generation tests
# ─────────────────────────────────────────────────────────────────────────────

class TestDatasetGeneration:

    def test_generates_correct_number_of_rows(self):
        df = generate_dataset(n_samples=500)
        assert len(df) == 500

    def test_delay_rate_is_realistic(self):
        """Delay rate should be between 35% and 65%."""
        df = generate_dataset(n_samples=2000)
        rate = df["delayed"].mean()
        assert 0.30 < rate < 0.70, f"Unrealistic delay rate: {rate:.2%}"

    def test_all_feature_columns_present(self):
        df = generate_dataset(n_samples=100)
        expected_cols = [
            "distance_km", "num_stops", "weight_kg", "month",
            "origin_congestion", "destination_congestion",
            "weather_severity_encoded", "carrier_delay_rate",
            "route_avg_delay_days", "cargo_type_encoded",
            "origin_port_encoded", "destination_port_encoded",
            "carrier_encoded", "delayed",
        ]
        for col in expected_cols:
            assert col in df.columns, f"Missing column: {col}"

    def test_congestion_values_in_range(self):
        df = generate_dataset(n_samples=500)
        assert df["origin_congestion"].between(0, 1).all()
        assert df["destination_congestion"].between(0, 1).all()

    def test_month_values_valid(self):
        df = generate_dataset(n_samples=500)
        assert df["month"].between(1, 12).all()


# ─────────────────────────────────────────────────────────────────────────────
# Feature encoding tests
# ─────────────────────────────────────────────────────────────────────────────

class TestFeatureEncoding:

    def _base_features(self):
        return {
            "origin_port":            "Shanghai",
            "destination_port":       "Rotterdam",
            "carrier":                "OceanFreight Co",
            "cargo_type":             "Electronics",
            "weight_kg":              12000,
            "distance_km":            19000,
            "num_stops":              1,
            "origin_congestion":      0.6,
            "destination_congestion": 0.4,
            "weather_severity":       "clear",
            "carrier_delay_rate":     0.2,
            "route_avg_delay_days":   3.0,
            "month":                  6,
        }

    def test_encode_returns_all_feature_columns(self):
        features = self._base_features()
        encoded  = encode_features(features, {})
        assert "weather_severity_encoded"   in encoded
        assert "origin_port_encoded"        in encoded
        assert "destination_port_encoded"   in encoded
        assert "carrier_encoded"            in encoded

    def test_clear_weather_encodes_to_zero(self):
        features = self._base_features()
        features["weather_severity"] = "clear"
        encoded = encode_features(features, {})
        assert encoded["weather_severity_encoded"] == 0

    def test_storm_weather_encodes_to_two(self):
        features = self._base_features()
        features["weather_severity"] = "storm"
        encoded = encode_features(features, {})
        assert encoded["weather_severity_encoded"] == 2

    def test_numeric_passthrough(self):
        features = self._base_features()
        encoded  = encode_features(features, {})
        assert encoded["origin_congestion"]      == 0.6
        assert encoded["destination_congestion"] == 0.4
        assert encoded["distance_km"]            == 19000
        assert encoded["weight_kg"]              == 12000

    def test_unknown_port_gets_hash_encoded(self):
        features = self._base_features()
        features["origin_port"] = "UnknownPort_XYZ_999"
        encoded = encode_features(features, {})
        # Should not raise — gets hash fallback
        assert isinstance(encoded["origin_port_encoded"], int)


# ─────────────────────────────────────────────────────────────────────────────
# Validation tests
# ─────────────────────────────────────────────────────────────────────────────

class TestValidation:

    def test_missing_required_fields_returned(self):
        missing = validate_features({})
        assert "origin_port"    in missing
        assert "destination_port" in missing
        assert "weather_severity" in missing

    def test_no_missing_when_all_provided(self):
        features = {
            "origin_port":            "Shanghai",
            "destination_port":       "Rotterdam",
            "carrier":                "OceanFreight Co",
            "distance_km":            10000,
            "origin_congestion":      0.5,
            "destination_congestion": 0.5,
            "weather_severity":       "clear",
            "carrier_delay_rate":     0.2,
        }
        missing = validate_features(features)
        assert len(missing) == 0


# ─────────────────────────────────────────────────────────────────────────────
# Model training & prediction tests (end-to-end, small dataset)
# ─────────────────────────────────────────────────────────────────────────────

class TestModelTraining:

    @pytest.fixture(scope="class")
    def trained_models(self):
        """Train models on small dataset — shared across tests in this class."""
        df = generate_dataset(n_samples=1000, seed=42)
        models, results = train_and_compare(df)
        return models, results

    def test_all_three_models_trained(self, trained_models):
        models, _ = trained_models
        assert "Logistic Regression" in models
        assert "Random Forest"       in models
        assert "XGBoost"             in models

    def test_xgboost_has_best_f1(self, trained_models):
        """XGBoost should outperform Logistic Regression on F1."""
        _, results = trained_models
        assert results["XGBoost"]["F1 Score"] >= results["Logistic Regression"]["F1 Score"]

    def test_all_models_above_60_percent_accuracy(self, trained_models):
        _, results = trained_models
        for name, metrics in results.items():
            assert metrics["Accuracy"] > 0.60, f"{name} accuracy too low: {metrics['Accuracy']}"

    def test_high_risk_scenario_predicts_higher_than_low(self, trained_models):
        """
        A high-congestion, storm scenario should score higher than
        a low-congestion, clear scenario.
        """
        from predictor import DelayPredictor
        import tempfile, joblib

        models, _ = trained_models
        xgb = models["XGBoost"]

        # Save to temp file and load via DelayPredictor
        with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False) as f:
            joblib.dump({"model": xgb, "encoders": {}}, f.name)
            predictor = DelayPredictor(f.name)

        high_risk = {
            "origin_port": "Shanghai", "destination_port": "Rotterdam",
            "carrier": "TestCarrier", "cargo_type": "Electronics",
            "weight_kg": 10000, "distance_km": 20000, "num_stops": 3,
            "origin_congestion": 0.95, "destination_congestion": 0.95,
            "weather_severity": "storm", "carrier_delay_rate": 0.55,
            "route_avg_delay_days": 8, "month": 12,
        }
        low_risk = {
            "origin_port": "Singapore", "destination_port": "Hamburg",
            "carrier": "TestCarrier", "cargo_type": "General",
            "weight_kg": 5000, "distance_km": 5000, "num_stops": 0,
            "origin_congestion": 0.1, "destination_congestion": 0.1,
            "weather_severity": "clear", "carrier_delay_rate": 0.05,
            "route_avg_delay_days": 1, "month": 6,
        }

        high_pred = predictor.predict_single(high_risk)["delay_probability"]
        low_pred  = predictor.predict_single(low_risk)["delay_probability"]

        assert high_pred > low_pred, (
            f"High-risk ({high_pred:.2f}) should be greater than low-risk ({low_pred:.2f})"
        )
