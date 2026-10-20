# ─────────────────────────────────────────────────────────────────────────────
# utils.py
# Feature encoding and validation helpers for the ML service.
# ─────────────────────────────────────────────────────────────────────────────

REQUIRED_FIELDS = [
    "origin_port",
    "destination_port",
    "carrier",
    "distance_km",
    "origin_congestion",
    "destination_congestion",
    "weather_severity",
    "carrier_delay_rate",
]

PORTS = [
    "Shanghai",
    "Rotterdam",
    "Singapore",
    "Mumbai",
    "Los Angeles",
    "Hamburg",
    "Felixstowe",
    "Busan",
    "Dubai",
    "Colombo",
]

CARRIERS = [
    "OceanFreight Co",
    "GlobalShip Ltd",
    "MarineX",
    "AquaLine",
    "SeaRoute Express",
]

WEATHER_MAP = {
    "clear":    0,
    "moderate": 1,
    "storm":    2,
}

CARGO_MAP = {
    "Electronics": 0,
    "Textiles":    1,
    "Food":        2,
    "Chemicals":   3,
    "Machinery":   4,
    "General":     5,
    "Other":       6,
}

DEFAULT_ENCODERS = {
    "origin_port_encoded": {name: idx for idx, name in enumerate(PORTS)},
    "destination_port_encoded": {name: idx for idx, name in enumerate(PORTS)},
    "carrier_encoded": {name: idx for idx, name in enumerate(CARRIERS)},
}


def validate_features(data: dict) -> list:
    """Returns list of missing required fields."""
    return [f for f in REQUIRED_FIELDS if f not in data]


def encode_features(features: dict, encoders: dict) -> dict:
    """
    Converts raw string/categorical features into numeric values
    the XGBoost model can consume.

    Uses label encoders saved during training when available,
    falls back to simple hash encoding for unseen categories.
    """
    encoded = {}

    # Numeric features — pass through directly
    encoded["distance_km"]            = float(features.get("distance_km", 8000))
    encoded["num_stops"]              = int(features.get("num_stops", 1))
    encoded["weight_kg"]              = float(features.get("weight_kg", 5000))
    encoded["month"]                  = int(features.get("month", 1))
    encoded["origin_congestion"]      = float(features.get("origin_congestion", 0.5))
    encoded["destination_congestion"] = float(features.get("destination_congestion", 0.5))
    encoded["carrier_delay_rate"]     = float(features.get("carrier_delay_rate", 0.2))
    encoded["route_avg_delay_days"]   = float(features.get("route_avg_delay_days", 2.0))

    # Weather — map to ordinal 0/1/2
    weather_raw = features.get("weather_severity", "clear").lower()
    encoded["weather_severity_encoded"] = WEATHER_MAP.get(weather_raw, 0)

    # Cargo type — map to int
    cargo_raw = features.get("cargo_type", "General")
    encoded["cargo_type_encoded"] = CARGO_MAP.get(cargo_raw, 6)

    # Categorical string features — use saved label encoders or hash
    active_encoders = DEFAULT_ENCODERS | encoders

    for col, raw_key in [
        ("origin_port_encoded",      "origin_port"),
        ("destination_port_encoded", "destination_port"),
        ("carrier_encoded",          "carrier"),
    ]:
        raw_val = features.get(raw_key, "unknown")
        encoder = active_encoders.get(col)
        if encoder and raw_val in encoder:
            encoded[col] = encoder[raw_val]
        else:
            # Fallback: stable hash so same string → same int
            encoded[col] = abs(hash(raw_val)) % 100

    return encoded
