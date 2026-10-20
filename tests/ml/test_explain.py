# ─────────────────────────────────────────────────────────────────────────────
# tests/ml/test_explain.py
# Per-shipment explanations (TreeSHAP) and evaluation helpers.
# Run with: python -m pytest tests/ml/ -v
# ─────────────────────────────────────────────────────────────────────────────

import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../ml"))

from fastapi.testclient import TestClient

import app as ml_app
from evaluate_model import oracle_ceiling
from predictor import FEATURE_COLUMNS
from train_model import generate_dataset

pytestmark = pytest.mark.skipif(
    ml_app.predictor.model is None, reason="trained model not present (run ml/train_model.py)"
)

RISKY = dict(
    origin_port="Shanghai", destination_port="Rotterdam", carrier="MarineX",
    origin_congestion=0.9, destination_congestion=0.85,
    weather_severity="storm", carrier_delay_rate=0.55,
)
SAFE = dict(
    origin_port="Shanghai", destination_port="Rotterdam", carrier="MarineX",
    origin_congestion=0.05, destination_congestion=0.05,
    weather_severity="clear", carrier_delay_rate=0.06,
)


class TestExplanations:
    def test_contributions_add_up_to_the_prediction(self):
        """TreeSHAP is additive: bias + sum(contributions) == logit(probability)."""
        result = ml_app.predictor.explain_single(RISKY)
        total = result["base_log_odds"] + sum(c["contribution"] for c in result["contributions"])
        prob = 1 / (1 + math.exp(-total))
        assert prob == pytest.approx(result["delay_probability"], abs=0.01)

    def test_every_feature_is_explained(self):
        result = ml_app.predictor.explain_single(RISKY)
        assert {c["feature"] for c in result["contributions"]} == set(FEATURE_COLUMNS)

    def test_top_factors_are_per_shipment_not_global(self):
        """Regression: top_factors used to be identical for every shipment."""
        risky = ml_app.predictor.predict_single(RISKY)["top_factors"]
        safe = ml_app.predictor.predict_single(SAFE)["top_factors"]
        assert risky != safe
        assert all(f["direction"] == "increases risk" for f in risky)
        assert all(f["direction"] == "decreases risk" for f in safe)

    def test_top_factors_keep_backwards_compatible_keys(self):
        for factor in ml_app.predictor.predict_single(RISKY)["top_factors"]:
            assert "factor" in factor and "importance" in factor
            # The dashboard renders importance * 100 as a percentage -> must stay in [0, 1]
            assert 0 <= factor["importance"] <= 1

    def test_top_factor_shares_never_exceed_100_percent(self):
        factors = ml_app.predictor.predict_single(RISKY)["top_factors"]
        assert sum(f["importance"] for f in factors) <= 1.0


class TestExplainEndpoint:
    client = TestClient(ml_app.app)

    def test_explain_returns_ranked_contributions(self):
        r = self.client.post("/explain", json=RISKY)
        assert r.status_code == 200
        body = r.json()
        sizes = [abs(c["contribution"]) for c in body["contributions"]]
        assert sizes == sorted(sizes, reverse=True)
        assert 0.0 <= body["delay_probability"] <= 1.0

    def test_explain_rejects_invalid_payload(self):
        assert self.client.post("/explain", json={"origin_port": "Shanghai"}).status_code == 422

    def test_predict_still_works(self):
        r = self.client.post("/predict", json=RISKY)
        assert r.status_code == 200
        assert r.json()["risk_level"] == "HIGH"


class TestEvaluationHelpers:
    def test_oracle_ceiling_is_a_valid_upper_reference(self):
        ceiling = oracle_ceiling(generate_dataset(n_samples=3000, seed=1))
        assert 0.75 < ceiling["accuracy"] < 0.95
        assert 0.85 < ceiling["auc"] < 1.0
