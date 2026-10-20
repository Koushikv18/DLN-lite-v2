# ─────────────────────────────────────────────────────────────────────────────
# app.py — DLN-Lite ML Service Entry Point
# FastAPI REST API serving XGBoost delay predictions.
# ─────────────────────────────────────────────────────────────────────────────

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Any

from predictor import DelayPredictor

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = FastAPI(title="DLN-Lite ML Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.getenv("MODEL_PATH", os.path.join(BASE_DIR, "models", "xgboost_model.pkl"))
predictor  = DelayPredictor(MODEL_PATH)


class ShipmentFeatures(BaseModel):
    origin_port: str
    destination_port: str
    carrier: str
    distance_km: float = Field(default=8000.0)
    origin_congestion: float = Field(default=0.5)
    destination_congestion: float = Field(default=0.5)
    weather_severity: str = Field(default="clear")
    carrier_delay_rate: float = Field(default=0.2)
    num_stops: int = Field(default=1)
    weight_kg: float = Field(default=5000.0)
    month: int = Field(default=1)
    route_avg_delay_days: float = Field(default=2.0)
    cargo_type: str = Field(default="General")


class BatchPredictionRequest(BaseModel):
    shipments: List[ShipmentFeatures]


# ─────────────────────────────────────────────────────────────────────────────
# POST /predict — single shipment prediction
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/predict")
async def predict(data: ShipmentFeatures):
    try:
        # Convert pydantic model to dict, matching what predictor expects
        result = predictor.predict_single(data.model_dump())
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# POST /batch-predict — multiple shipments at once
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/batch-predict")
async def batch_predict(request: BatchPredictionRequest):
    if not request.shipments:
        raise HTTPException(status_code=400, detail="No shipments provided")
    
    try:
        data = [s.model_dump() for s in request.shipments]
        predictions = predictor.predict_batch(data)
        return {"predictions": predictions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# GET /health
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":       "ok",
        "model_loaded": predictor.model is not None,
        "model_path":   MODEL_PATH,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /model-info — returns feature importances (useful for dashboard)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/model-info")
async def model_info():
    if predictor.model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    feature_names = [
        "distance_km", "num_stops", "weight_kg", "month",
        "origin_congestion", "destination_congestion",
        "weather_severity_encoded", "carrier_delay_rate",
        "route_avg_delay_days", "cargo_type_encoded",
        "origin_port_encoded", "destination_port_encoded", "carrier_encoded",
    ]

    importances = predictor.model.feature_importances_.tolist()

    return {
        "model_type":   "XGBoost",
        "feature_importances": dict(zip(feature_names, importances)),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 5000))
    print(f"[START] DLN-Lite ML Service running on port {port} with FastAPI")
    # Note: Use `app:app` string for reload to work
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=os.getenv("FLASK_ENV") == "development")
