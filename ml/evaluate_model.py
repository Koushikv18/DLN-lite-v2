# ─────────────────────────────────────────────────────────────────────────────
# evaluate_model.py
# Honest, reproducible evaluation of the delay-risk model.
#
#   python evaluate_model.py                 -> writes ../docs/ML_EVALUATION.md
#   python evaluate_model.py --out some/dir  -> writes into some/dir
#
# Why this exists: the training labels are generated from a known formula over
# the same features the model sees. A high test score alone therefore proves
# little. This script measures what DOES carry information:
#
#   1. Stratified 5-fold cross-validation (mean +/- std), not one lucky split.
#   2. The "oracle ceiling": the accuracy of the true generating rule. A model
#      cannot honestly beat this; matching it means the model recovered the
#      rule, nothing more.
#   3. Sanity check on feature importance: features the generator ignores
#      (weight, cargo, ports, carrier id, distance) should get ~0 importance.
#   4. Calibration (Brier score, reliability table): are probabilities honest?
#   5. Robustness to label noise and to distribution shift.
# ─────────────────────────────────────────────────────────────────────────────

import argparse
import os
import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    f1_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import StratifiedKFold, train_test_split
from xgboost import XGBClassifier

from train_model import generate_dataset

warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Features the label generator actually uses (see train_model.generate_dataset)
TRUE_DRIVERS = [
    "origin_congestion",
    "destination_congestion",
    "weather_severity_encoded",
    "carrier_delay_rate",
    "num_stops",
    "month",
]


def make_models():
    return {
        "Logistic Regression": LogisticRegression(max_iter=1000, random_state=42),
        "Random Forest": RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1),
        "XGBoost": XGBClassifier(
            n_estimators=200,
            learning_rate=0.05,
            max_depth=6,
            subsample=0.8,
            colsample_bytree=0.8,
            eval_metric="logloss",
            random_state=42,
        ),
    }


def oracle_scores(df: pd.DataFrame) -> np.ndarray:
    """Noise-free delay score used by the generator (the ground-truth rule)."""
    peak = np.isin(df["month"], [11, 12, 1]).astype(float)
    return (
        0.30 * df["origin_congestion"]
        + 0.25 * df["destination_congestion"]
        + 0.20 * (df["weather_severity_encoded"] / 2.0)
        + 0.15 * df["carrier_delay_rate"]
        + 0.05 * (df["num_stops"] / 4.0)
        + 0.05 * peak
    ).to_numpy()


def oracle_ceiling(df: pd.DataFrame) -> dict:
    """Accuracy / AUC of the true rule (without the label noise it can't see)."""
    score = oracle_scores(df)
    pred = (score > 0.45).astype(int)
    return {
        "accuracy": float(accuracy_score(df["delayed"], pred)),
        "auc": float(roc_auc_score(df["delayed"], score)),
    }


def cross_validate(df: pd.DataFrame, folds: int = 5) -> pd.DataFrame:
    feats = [c for c in df.columns if c != "delayed"]
    X, y = df[feats], df["delayed"]
    skf = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)

    rows = []
    for name, _ in make_models().items():
        accs, f1s, aucs = [], [], []
        for tr, te in skf.split(X, y):
            model = make_models()[name]
            model.fit(X.iloc[tr], y.iloc[tr])
            pred = model.predict(X.iloc[te])
            prob = model.predict_proba(X.iloc[te])[:, 1]
            accs.append(accuracy_score(y.iloc[te], pred))
            f1s.append(f1_score(y.iloc[te], pred))
            aucs.append(roc_auc_score(y.iloc[te], prob))
        rows.append(
            {
                "Model": name,
                "Accuracy": f"{np.mean(accs):.4f} ± {np.std(accs):.4f}",
                "F1": f"{np.mean(f1s):.4f} ± {np.std(f1s):.4f}",
                "AUC-ROC": f"{np.mean(aucs):.4f} ± {np.std(aucs):.4f}",
            }
        )
    return pd.DataFrame(rows)


def importance_sanity(df: pd.DataFrame) -> pd.DataFrame:
    feats = [c for c in df.columns if c != "delayed"]
    model = make_models()["XGBoost"].fit(df[feats], df["delayed"])
    imp = pd.Series(model.feature_importances_, index=feats).sort_values(ascending=False)
    out = imp.reset_index()
    out.columns = ["Feature", "Importance"]
    out["Used by generator?"] = out["Feature"].map(lambda f: "yes" if f in TRUE_DRIVERS else "no")
    out["Importance"] = out["Importance"].round(4)
    return out


def calibration(df: pd.DataFrame, bins: int = 10):
    feats = [c for c in df.columns if c != "delayed"]
    Xtr, Xte, ytr, yte = train_test_split(
        df[feats], df["delayed"], test_size=0.2, random_state=42, stratify=df["delayed"]
    )
    model = make_models()["XGBoost"].fit(Xtr, ytr)
    prob = model.predict_proba(Xte)[:, 1]
    brier = brier_score_loss(yte, prob)

    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(prob, edges) - 1, 0, bins - 1)
    rows = []
    for b in range(bins):
        mask = idx == b
        if mask.sum() == 0:
            continue
        rows.append(
            {
                "Predicted range": f"{edges[b]:.1f}–{edges[b + 1]:.1f}",
                "Samples": int(mask.sum()),
                "Mean predicted": round(float(prob[mask].mean()), 3),
                "Actual delay rate": round(float(yte.to_numpy()[mask].mean()), 3),
            }
        )
    fpr, tpr, _ = roc_curve(yte, prob)
    return brier, pd.DataFrame(rows), (fpr, tpr), (yte.to_numpy(), prob)


def label_noise_robustness(df: pd.DataFrame, rates=(0.0, 0.05, 0.10, 0.20)) -> pd.DataFrame:
    """Train on corrupted labels, test on CLEAN held-out labels."""
    feats = [c for c in df.columns if c != "delayed"]
    Xtr, Xte, ytr, yte = train_test_split(
        df[feats], df["delayed"], test_size=0.2, random_state=42, stratify=df["delayed"]
    )
    rng = np.random.default_rng(0)
    rows = []
    for rate in rates:
        y_noisy = ytr.to_numpy().copy()
        flip = rng.random(len(y_noisy)) < rate
        y_noisy[flip] = 1 - y_noisy[flip]
        model = make_models()["XGBoost"].fit(Xtr, y_noisy)
        prob = model.predict_proba(Xte)[:, 1]
        rows.append(
            {
                "Training labels flipped": f"{rate:.0%}",
                "Test accuracy": round(accuracy_score(yte, (prob > 0.5).astype(int)), 4),
                "Test AUC": round(roc_auc_score(yte, prob), 4),
            }
        )
    return pd.DataFrame(rows)


def distribution_shift(df: pd.DataFrame) -> pd.DataFrame:
    """
    Train on the normal world; test on a congested world (congestion +0.25,
    clipped to [0,1]) where labels follow the same rule. Shows how far the
    model can be trusted outside the data it saw.
    """
    feats = [c for c in df.columns if c != "delayed"]
    model = make_models()["XGBoost"].fit(df[feats], df["delayed"])

    shifted = generate_dataset(n_samples=4000, seed=7)
    for col in ("origin_congestion", "destination_congestion"):
        shifted[col] = np.clip(shifted[col] + 0.25, 0, 1)
    # re-derive labels with the same rule so only the *inputs* shifted
    rng = np.random.default_rng(7)
    score = oracle_scores(shifted) + rng.normal(0, 0.08, len(shifted))
    shifted["delayed"] = (np.clip(score, 0, 1) > 0.45).astype(int)

    rows = []
    for label, data in (("In-distribution", generate_dataset(n_samples=4000, seed=11)), ("Congested (shifted)", shifted)):
        prob = model.predict_proba(data[feats])[:, 1]
        rows.append(
            {
                "Test set": label,
                "Delay rate": round(float(data["delayed"].mean()), 3),
                "Accuracy": round(accuracy_score(data["delayed"], (prob > 0.5).astype(int)), 4),
                "AUC": round(roc_auc_score(data["delayed"], prob), 4),
            }
        )
    return pd.DataFrame(rows)


def md_table(df: pd.DataFrame) -> str:
    return df.to_markdown(index=False)


def make_charts(out_dir, roc, calib_tables, importance):
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return []

    os.makedirs(out_dir, exist_ok=True)
    files = []

    fpr, tpr = roc
    fig, ax = plt.subplots(figsize=(4.5, 4))
    ax.plot(fpr, tpr, label="XGBoost")
    ax.plot([0, 1], [0, 1], "--", color="grey", label="Chance")
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.set_title("ROC curve (held-out test set)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, "ml_roc.png"), dpi=130)
    plt.close(fig)
    files.append("ml_roc.png")

    fig, ax = plt.subplots(figsize=(4.5, 4))
    ax.plot([0, 1], [0, 1], "--", color="grey", label="Perfectly calibrated")
    ax.plot(calib_tables["Mean predicted"], calib_tables["Actual delay rate"], "o-", label="XGBoost")
    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Actual delay rate")
    ax.set_title("Calibration")
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, "ml_calibration.png"), dpi=130)
    plt.close(fig)
    files.append("ml_calibration.png")

    imp = importance.sort_values("Importance")
    colors = ["#2b7a78" if u == "yes" else "#b0b0b0" for u in imp["Used by generator?"]]
    fig, ax = plt.subplots(figsize=(6, 4.5))
    ax.barh(imp["Feature"], imp["Importance"], color=colors)
    ax.set_title("Feature importance (teal = used by label rule)")
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, "ml_importance.png"), dpi=130)
    plt.close(fig)
    files.append("ml_importance.png")
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(BASE_DIR, "..", "docs"))
    parser.add_argument("--samples", type=int, default=10000)
    args = parser.parse_args()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    print("Generating dataset...")
    df = generate_dataset(n_samples=args.samples)

    print("Cross-validating...")
    cv = cross_validate(df)
    ceiling = oracle_ceiling(df)
    importance = importance_sanity(df)
    brier, calib, roc, _ = calibration(df)
    noise = label_noise_robustness(df)
    shift = distribution_shift(df)
    charts = make_charts(out_dir, roc, calib, importance)

    irrelevant = importance[importance["Used by generator?"] == "no"]["Importance"].sum()
    relevant = importance[importance["Used by generator?"] == "yes"]["Importance"].sum()

    report = f"""# ML Evaluation — Delay-Risk Model

> Generated by `ml/evaluate_model.py` (n = {args.samples:,}, fixed seeds). Re-run it to reproduce every number below.

## Read this first: what these numbers do and do not prove

The training data is **synthetic**. Delay labels are produced by a known rule over congestion, weather, carrier delay rate, stops and season, plus Gaussian noise. So these results show that the pipeline (feature encoding → training → serving → explanation) works and that the model recovers the rule. They do **not** show how well it would predict delays on real shipments. Validating on real port/carrier data is the main piece of future work.

## 1. Cross-validated model comparison (5-fold, stratified)

{md_table(cv)}

## 2. Oracle ceiling

The true generating rule, applied without the label noise it cannot see, scores:

| Accuracy | AUC |
|---|---|
| {ceiling['accuracy']:.4f} | {ceiling['auc']:.4f} |

No model can honestly beat this ceiling. The closer XGBoost sits to it, the more completely it has recovered the rule — and nothing more.

## 3. Feature-importance sanity check

{md_table(importance)}

Importance on features the label rule ignores (weight, cargo, ports, carrier id, distance, route history): **{irrelevant:.1%}** of total. On features it uses: **{relevant:.1%}**. A model that learned the right structure should concentrate on the second group.

## 4. Calibration

Brier score: **{brier:.4f}** (lower is better; 0.25 is a coin-flip baseline).

{md_table(calib)}

## 5. Robustness

**Label noise** — trained on corrupted labels, tested on clean labels:

{md_table(noise)}

**Distribution shift** — same rule, but test shipments come from a more congested world than the training data:

{md_table(shift)}

## Charts

""" + "\n".join(f"![{c}]({c})" for c in charts) + """

## Limitations (stated plainly)

- Synthetic labels: results are an upper bound on realistic performance.
- Port/carrier identity is label-encoded as integers; with real data a target or one-hot encoding should be compared.
- `predicted_delay_days` in the API is a heuristic, not a trained regressor.
- Per-shipment explanations use TreeSHAP contributions (log-odds); they explain the *model*, not causality in the real world.
"""

    path = os.path.join(out_dir, "ML_EVALUATION.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"Report written to {path}")


if __name__ == "__main__":
    main()
