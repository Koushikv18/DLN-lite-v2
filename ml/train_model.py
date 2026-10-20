# ─────────────────────────────────────────────────────────────────────────────
# train_model.py
# Generates synthetic shipping data and trains 3 models:
#   1. Logistic Regression (baseline)
#   2. Random Forest       (middle)
#   3. XGBoost             (final — best performing)
#
# Saves the best model to models/xgboost_model.pkl
# Prints a comparison table for dissertation use.
# ─────────────────────────────────────────────────────────────────────────────

import numpy as np
import pandas as pd
import joblib
import os
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, roc_auc_score, classification_report
)
from xgboost import XGBClassifier

from utils import CARGO_MAP, CARRIERS, DEFAULT_ENCODERS, PORTS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Generate synthetic dataset
# ─────────────────────────────────────────────────────────────────────────────

def generate_dataset(n_samples: int = 10000, seed: int = 42) -> pd.DataFrame:
    """
    Creates realistic synthetic shipping data.
    Delay probability is driven by real-world patterns:
      - High congestion → more delays
      - Storms → more delays
      - Peak season (Nov–Jan) → more delays
      - High carrier delay rate → more delays
    """
    np.random.seed(seed)

    # Raw feature generation
    distance_km            = np.random.uniform(500, 22000, n_samples)
    num_stops              = np.random.randint(0, 5, n_samples)
    weight_kg              = np.random.uniform(100, 30000, n_samples)
    month                  = np.random.randint(1, 13, n_samples)
    origin_congestion      = np.random.uniform(0, 1, n_samples)
    destination_congestion = np.random.uniform(0, 1, n_samples)
    weather_severity       = np.random.choice([0, 1, 2], n_samples, p=[0.6, 0.3, 0.1])  # 0=clear,1=mod,2=storm
    carrier_delay_rate     = np.random.uniform(0.05, 0.60, n_samples)
    route_avg_delay_days   = np.random.uniform(0, 10, n_samples)

    cargo_types = list(CARGO_MAP.keys())[:-1]  # Exclude "Other" from synthetic training data.

    origin_ports      = np.random.choice(PORTS, n_samples)
    destination_ports = np.random.choice(PORTS, n_samples)
    carriers          = np.random.choice(CARRIERS, n_samples)
    cargo_type_names  = np.random.choice(cargo_types, n_samples)

    origin_port_encoded = np.array(
        [DEFAULT_ENCODERS["origin_port_encoded"][port] for port in origin_ports]
    )
    destination_port_encoded = np.array(
        [DEFAULT_ENCODERS["destination_port_encoded"][port] for port in destination_ports]
    )
    carrier_encoded = np.array(
        [DEFAULT_ENCODERS["carrier_encoded"][carrier] for carrier in carriers]
    )
    cargo_type_encoded = np.array([CARGO_MAP[cargo] for cargo in cargo_type_names])

    # ── Delay label generation (realistic rules) ──────────────────────────────
    # Base delay probability driven by features
    delay_score = (
        0.30 * origin_congestion +
        0.25 * destination_congestion +
        0.20 * (weather_severity / 2.0) +
        0.15 * carrier_delay_rate +
        0.05 * (num_stops / 4.0) +
        0.05 * np.where(np.isin(month, [11, 12, 1]), 1.0, 0.0)  # peak season boost
    )

    # Add noise to make it realistic
    noise = np.random.normal(0, 0.08, n_samples)
    delay_prob = np.clip(delay_score + noise, 0, 1)

    # Binary label: 1 = delayed, 0 = on time
    delayed = (delay_prob > 0.45).astype(int)

    df = pd.DataFrame({
        "distance_km":              distance_km,
        "num_stops":                num_stops,
        "weight_kg":                weight_kg,
        "month":                    month,
        "origin_congestion":        origin_congestion,
        "destination_congestion":   destination_congestion,
        "weather_severity_encoded": weather_severity,
        "carrier_delay_rate":       carrier_delay_rate,
        "route_avg_delay_days":     route_avg_delay_days,
        "cargo_type_encoded":       cargo_type_encoded,
        "origin_port_encoded":      origin_port_encoded,
        "destination_port_encoded": destination_port_encoded,
        "carrier_encoded":          carrier_encoded,
        "delayed":                  delayed,
    })

    print(f"Dataset generated: {n_samples} samples")
    print(f"Delay rate: {delayed.mean():.1%}  (target: ~40–50%)")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Train all 3 models and compare
# ─────────────────────────────────────────────────────────────────────────────

def train_and_compare(df: pd.DataFrame):
    FEATURE_COLS = [c for c in df.columns if c != "delayed"]
    X = df[FEATURE_COLS]
    y = df["delayed"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    models = {
        "Logistic Regression": LogisticRegression(max_iter=500, random_state=42),
        "Random Forest":       RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1),
        "XGBoost":             XGBClassifier(
                                   n_estimators=200,
                                   learning_rate=0.05,
                                   max_depth=6,
                                   subsample=0.8,
                                   colsample_bytree=0.8,
                                   use_label_encoder=False,
                                   eval_metric="logloss",
                                   random_state=42,
                               ),
    }

    results = {}
    trained_models = {}

    print("\n" + "="*65)
    print("  MODEL TRAINING & COMPARISON")
    print("="*65)

    for name, model in models.items():
        print(f"\nTraining {name}...")
        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)[:, 1]

        metrics = {
            "Accuracy":  round(accuracy_score(y_test, y_pred), 4),
            "Precision": round(precision_score(y_test, y_pred), 4),
            "Recall":    round(recall_score(y_test, y_pred), 4),
            "F1 Score":  round(f1_score(y_test, y_pred), 4),
            "AUC-ROC":   round(roc_auc_score(y_test, y_prob), 4),
        }
        results[name] = metrics
        trained_models[name] = model

        print(f"  Accuracy:  {metrics['Accuracy']:.1%}")
        print(f"  F1 Score:  {metrics['F1 Score']:.1%}")
        print(f"  AUC-ROC:   {metrics['AUC-ROC']:.1%}")

    # Print comparison table (copy this into your dissertation)
    print("\n" + "="*65)
    print("  RESULTS TABLE (copy into dissertation)")
    print("="*65)
    header = f"{'Model':<25} {'Acc':>8} {'Prec':>8} {'Recall':>8} {'F1':>8} {'AUC':>8}"
    print(header)
    print("-" * 65)
    for name, metrics in results.items():
        row = (
            f"{name:<25} "
            f"{metrics['Accuracy']:>8.4f} "
            f"{metrics['Precision']:>8.4f} "
            f"{metrics['Recall']:>8.4f} "
            f"{metrics['F1 Score']:>8.4f} "
            f"{metrics['AUC-ROC']:>8.4f}"
        )
        print(row)
    print("="*65)

    return trained_models, results


# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Save the best model (XGBoost)
# ─────────────────────────────────────────────────────────────────────────────

def save_model(
    model,
    output_path: str = os.path.join(BASE_DIR, "models", "xgboost_model.pkl"),
    encoders: dict | None = None,
):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Save model + any encoders needed for inference
    joblib.dump({"model": model, "encoders": encoders or DEFAULT_ENCODERS}, output_path)
    print(f"\n✅ XGBoost model saved to {output_path}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Save the dataset (for inspection/notebooks)
# ─────────────────────────────────────────────────────────────────────────────

def save_dataset(df: pd.DataFrame, path: str = os.path.join(BASE_DIR, "data", "synthetic_shipments.csv")):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    df.to_csv(path, index=False)
    print(f"✅ Dataset saved to {path}")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("DLN-Lite — ML Model Training")
    print("Generating synthetic dataset...")

    df = generate_dataset(n_samples=10000)
    save_dataset(df)

    trained_models, results = train_and_compare(df)

    # Save XGBoost as the production model
    save_model(trained_models["XGBoost"], encoders=DEFAULT_ENCODERS)

    print("\n🎯 Training complete. XGBoost is now the active model.")
    print("   Start the Flask server with: python app.py")
