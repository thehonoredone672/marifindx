"""AIS ingestion, normalisation and trajectory reconstruction.

Reads MarineCadastre-style CSV exports (https://marinecadastre.gov/accessais/)
and normalises heterogeneous column spellings into one schema:

    mmsi, vessel_name, vessel_type, timestamp, latitude, longitude,
    sog, cog, heading

When no AIS file is supplied the module falls back to a deterministic
SYNTHETIC generator. Synthetic tracks are always tagged
`synthetic=True` and surfaced in the UI as "Synthetic AIS Demonstration
Data" -- they must never be presented as real vessel movements.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .geo_service import bearing_deg, haversine_km, offset_km

# MarineCadastre and common AIS exports disagree on column names.
COLUMN_ALIASES: dict[str, list[str]] = {
    "mmsi": ["mmsi", "MMSI", "mmsi_id", "userid", "UserID"],
    "vessel_name": ["vesselname", "VesselName", "name", "Name", "shipname", "ship_name"],
    "vessel_type": ["vesseltype", "VesselType", "shiptype", "ship_type", "type", "Type"],
    "timestamp": ["basedatetime", "BaseDateTime", "timestamp", "Timestamp",
                  "datetime", "DateTime", "time", "date_time_utc"],
    "latitude": ["lat", "LAT", "Lat", "latitude", "Latitude", "y"],
    "longitude": ["lon", "LON", "Lon", "longitude", "Longitude", "x"],
    "sog": ["sog", "SOG", "speed", "Speed", "speed_over_ground"],
    "cog": ["cog", "COG", "course", "Course", "course_over_ground"],
    "heading": ["heading", "Heading", "hdg", "HDG", "true_heading"],
}

# Numeric AIS ship-type codes -> readable categories.
TYPE_CODES = {
    (30, 30): "Fishing", (31, 32): "Tug", (36, 37): "Pleasure",
    (60, 69): "Passenger", (70, 79): "Cargo", (80, 89): "Tanker",
}


def _canonical_type(value: Any) -> str:
    if value is None:
        return "Unknown"
    text = str(value).strip()
    if not text or text.lower() in ("nan", "none"):
        return "Unknown"
    try:
        code = int(float(text))
        for (lo, hi), label in TYPE_CODES.items():
            if lo <= code <= hi:
                return label
        return f"Type {code}"
    except ValueError:
        return text.title()


def _parse_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    for fmt in (
        "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z", "%Y/%m/%d %H:%M:%S", "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M", "%Y%m%d%H%M%S",
    ):
        try:
            dt = datetime.strptime(text.replace("Z", ""), fmt.replace("Z", ""))
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _resolve_columns(header: list[str]) -> dict[str, str]:
    lowered = {h.lower().strip(): h for h in header}
    resolved: dict[str, str] = {}
    for field_name, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias.lower() in lowered:
                resolved[field_name] = lowered[alias.lower()]
                break
    return resolved


@dataclass
class VesselTrack:
    mmsi: str
    name: str
    vessel_type: str
    points: list[dict[str, Any]] = field(default_factory=list)
    synthetic: bool = False

    def sort(self) -> None:
        self.points.sort(key=lambda p: p["timestamp"])

    def time_span(self) -> tuple[datetime, datetime] | None:
        if not self.points:
            return None
        return self.points[0]["timestamp"], self.points[-1]["timestamp"]

    def position_at(self, when: datetime) -> dict[str, Any] | None:
        """Linear interpolation between the bracketing AIS reports."""
        if not self.points:
            return None
        if when <= self.points[0]["timestamp"]:
            return dict(self.points[0])
        if when >= self.points[-1]["timestamp"]:
            return dict(self.points[-1])

        for a, b in zip(self.points, self.points[1:]):
            if a["timestamp"] <= when <= b["timestamp"]:
                span = (b["timestamp"] - a["timestamp"]).total_seconds()
                f = 0.0 if span <= 0 else (when - a["timestamp"]).total_seconds() / span
                return {
                    "timestamp": when,
                    "latitude": a["latitude"] + f * (b["latitude"] - a["latitude"]),
                    "longitude": a["longitude"] + f * (b["longitude"] - a["longitude"]),
                    "sog": a.get("sog", 0.0) + f * (b.get("sog", 0.0) - a.get("sog", 0.0)),
                    "cog": a.get("cog", 0.0),
                    "heading": a.get("heading", a.get("cog", 0.0)),
                }
        return dict(self.points[-1])

    def closest_approach(self, lon: float, lat: float) -> dict[str, Any]:
        """Nearest AIS report to a point, with distance in km."""
        best = None
        for p in self.points:
            d = haversine_km(p["longitude"], p["latitude"], lon, lat)
            if best is None or d < best["distance_km"]:
                best = {"distance_km": d, "point": p}
        return best or {"distance_km": float("inf"), "point": None}

    def to_dict(self) -> dict[str, Any]:
        self.sort()
        last = self.points[-1] if self.points else {}
        return {
            "id": self.mmsi,
            "mmsi": self.mmsi,
            "name": self.name,
            "type": self.vessel_type,
            "synthetic": self.synthetic,
            "point_count": len(self.points),
            "trajectory": [
                {
                    "lat": round(float(p["latitude"]), 6),
                    "lon": round(float(p["longitude"]), 6),
                    "time": p["timestamp"].isoformat(),
                    "sog": round(float(p.get("sog", 0.0)), 2),
                    "cog": round(float(p.get("cog", 0.0)), 1),
                    "heading": round(float(p.get("heading", p.get("cog", 0.0))), 1),
                }
                for p in self.points
            ],
            "position": {
                "lat": round(float(last.get("latitude", 0.0)), 6),
                "lon": round(float(last.get("longitude", 0.0)), 6),
                "time": last["timestamp"].isoformat() if last else None,
            },
            "movement": {
                "speed": round(float(last.get("sog", 0.0)), 2),
                "heading": round(float(last.get("heading", last.get("cog", 0.0))), 1),
                "course": round(float(last.get("cog", 0.0)), 1),
            },
        }


def load_ais_csv(path: str | Path, cfg: dict[str, Any] | None = None) -> list[VesselTrack]:
    """Load and normalise a MarineCadastre-style AIS CSV."""
    import csv

    cfg = cfg or {}
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"AIS file not found: {path}")

    tracks: dict[str, VesselTrack] = {}
    seen: set[tuple[str, str]] = set()
    skipped = 0

    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            return []
        cols = _resolve_columns(list(reader.fieldnames))
        for required in ("mmsi", "timestamp", "latitude", "longitude"):
            if required not in cols:
                raise ValueError(
                    f"AIS CSV missing a '{required}' column. "
                    f"Found columns: {reader.fieldnames}"
                )

        for row in reader:
            mmsi = str(row.get(cols["mmsi"], "")).strip()
            ts = _parse_timestamp(row.get(cols["timestamp"]))
            try:
                lat = float(row.get(cols["latitude"]))
                lon = float(row.get(cols["longitude"]))
            except (TypeError, ValueError):
                skipped += 1
                continue

            # Validation: reject impossible fixes outright.
            if not mmsi or ts is None or not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                skipped += 1
                continue

            key = (mmsi, ts.isoformat())
            if key in seen:  # deduplicate identical reports
                continue
            seen.add(key)

            def num(field_name: str, default: float = 0.0) -> float:
                if field_name not in cols:
                    return default
                try:
                    return float(row.get(cols[field_name]))
                except (TypeError, ValueError):
                    return default

            if mmsi not in tracks:
                raw_name = row.get(cols.get("vessel_name", ""), "") or f"MMSI {mmsi}"
                tracks[mmsi] = VesselTrack(
                    mmsi=mmsi,
                    name=str(raw_name).strip() or f"MMSI {mmsi}",
                    vessel_type=_canonical_type(row.get(cols.get("vessel_type", ""))),
                )
            tracks[mmsi].points.append(
                {
                    "timestamp": ts,
                    "latitude": lat,
                    "longitude": lon,
                    "sog": num("sog"),
                    "cog": num("cog"),
                    "heading": num("heading", num("cog")),
                }
            )

    min_points = int(cfg.get("min_points_per_track", 2))
    result = []
    for track in tracks.values():
        track.sort()
        if len(track.points) >= min_points:
            result.append(track)

    print(f"[ais] loaded {len(result)} tracks from {path.name} ({skipped} rows skipped)")
    return result


def generate_synthetic_ais(
    origin_lon: float,
    origin_lat: float,
    release_time: datetime,
    cfg: dict[str, Any],
) -> list[VesselTrack]:
    """Deterministic demonstration fleet around a probable-origin zone.

    The scenario is FIXED in advance (see SCENARIO below) and is not tuned
    after inspecting any ranking: one vessel is authored to transit the
    origin zone inside the release window, a few pass nearby, and the rest
    are clearly unrelated. This lets the correlation engine be exercised
    against a known answer without that answer being reverse-engineered
    from the scores.
    """
    import random

    syn = cfg.get("synthetic", {})
    seed = int(syn.get("seed", 20260921))
    rng = random.Random(seed)
    n_vessels = int(syn.get("vessels", 9))
    interval_min = float(syn.get("sample_interval_minutes", 10))
    hours_before = float(syn.get("hours_before_release", 6))
    hours_after = float(syn.get("hours_after_release", 6))

    # (name, type, role, closest_approach_km, time_offset_h, heading_deg)
    SCENARIO = [
        ("MT Konkan Voyager",   "Tanker",    "transits_origin", 0.8,  0.0, 118.0),
        ("MT Coastal Sentinel", "Tanker",    "near",            6.5,  1.5, 95.0),
        ("MV Ganga Pride",      "Cargo",     "near",            11.0, -2.5, 210.0),
        ("MSC Palana",          "Container", "distant",         19.0,  4.0, 305.0),
        ("MSC Horizon",         "Container", "distant",         23.0, -5.0, 260.0),
        ("FV Sagar Tara",       "Fishing",   "distant",         16.0,  3.0, 40.0),
        ("MV Deccan Trader",    "Cargo",     "distant",         28.0,  5.5, 150.0),
        ("TUG Anchor Bay",      "Tug",       "distant",         21.0, -4.5, 75.0),
        ("MT Arabian Star",     "Tanker",    "near",            9.0,  2.0, 132.0),
    ][:n_vessels]

    total_hours = hours_before + hours_after
    n_points = max(4, int(total_hours * 60 / interval_min))
    tracks: list[VesselTrack] = []

    for idx, (name, vtype, role, approach_km, t_offset_h, heading) in enumerate(SCENARIO):
        mmsi = str(419000000 + seed % 1000 + idx * 137)
        speed_kn = {
            "Tanker": 12.5, "Cargo": 14.0, "Container": 18.5,
            "Fishing": 7.0, "Tug": 9.0,
        }.get(vtype, 12.0)
        speed_kn += rng.uniform(-1.2, 1.2)
        speed_kmh = speed_kn * 1.852

        # Closest-approach point, offset perpendicular to the track.
        perp = math.radians((heading + 90.0) % 360.0)
        ca_lon, ca_lat = offset_km(
            origin_lon, origin_lat,
            approach_km * math.sin(perp), approach_km * math.cos(perp),
        )
        t_closest = release_time + timedelta(hours=t_offset_h)

        track = VesselTrack(mmsi=mmsi, name=name, vessel_type=vtype, synthetic=True)
        head_rad = math.radians(heading)

        for k in range(n_points):
            t = release_time - timedelta(hours=hours_before) + timedelta(
                minutes=k * interval_min
            )
            dt_h = (t - t_closest).total_seconds() / 3600.0
            along_km = speed_kmh * dt_h
            # Gentle course change so tracks are curves, not rigid lines.
            curve = math.sin(dt_h / 5.0) * 1.1
            lon, lat = offset_km(
                ca_lon, ca_lat,
                along_km * math.sin(head_rad) + curve,
                along_km * math.cos(head_rad) + curve * 0.4,
            )
            track.points.append(
                {
                    "timestamp": t,
                    "latitude": lat,
                    "longitude": lon,
                    "sog": round(speed_kn + rng.uniform(-0.4, 0.4), 2),
                    "cog": round((heading + curve * 4.0) % 360.0, 1),
                    "heading": round((heading + curve * 3.0) % 360.0, 1),
                }
            )
        track.sort()
        tracks.append(track)

    print(f"[ais] generated {len(tracks)} SYNTHETIC demonstration tracks (seed={seed})")
    return tracks


def load_ais(
    cfg: dict[str, Any],
    origin_lon: float,
    origin_lat: float,
    release_time: datetime,
) -> tuple[list[VesselTrack], dict[str, Any]]:
    """Resolve the AIS source per config: file when present, else synthetic."""
    source = str(cfg.get("source", "auto"))
    ais_file = cfg.get("file")

    if source in ("auto", "file") and ais_file:
        path = Path(ais_file)
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[1] / path
        if path.exists():
            try:
                tracks = load_ais_csv(path, cfg)
                if tracks:
                    return tracks, {
                        "source": "file",
                        "path": str(path),
                        "synthetic": False,
                        "label": "Real AIS Data",
                    }
            except Exception as exc:
                print(f"[ais] failed to read {path}: {exc}; falling back to synthetic")
        elif source == "file":
            print(f"[ais] configured file missing: {path}; falling back to synthetic")

    tracks = generate_synthetic_ais(origin_lon, origin_lat, release_time, cfg)
    return tracks, {
        "source": "synthetic",
        "synthetic": True,
        "label": "Synthetic AIS Demonstration Data",
        "notice": (
            "These vessel tracks are procedurally generated for demonstration. "
            "They are NOT real vessel movements and no real vessel or operator "
            "is implicated."
        ),
        "seed": cfg.get("synthetic", {}).get("seed"),
    }


def filter_candidates(
    tracks: list[VesselTrack],
    origin_lon: float,
    origin_lat: float,
    window_start: datetime,
    window_end: datetime,
    cfg: dict[str, Any],
) -> list[VesselTrack]:
    """Spatial + temporal gate on the probable-origin zone."""
    radius = float(cfg.get("candidate_radius_km", 25.0))
    pad = timedelta(hours=float(cfg.get("release_window_pad_hours", 2.0)))
    lo, hi = window_start - pad, window_end + pad

    candidates = []
    for track in tracks:
        in_window = [p for p in track.points if lo <= p["timestamp"] <= hi]
        if not in_window:
            continue
        nearest = min(
            haversine_km(p["longitude"], p["latitude"], origin_lon, origin_lat)
            for p in in_window
        )
        if nearest <= radius:
            candidates.append(track)

    print(
        f"[ais] {len(candidates)}/{len(tracks)} vessels inside "
        f"{radius:.1f} km and the release window"
    )
    return candidates


def tracks_to_geojson(tracks: list[VesselTrack]) -> dict[str, Any]:
    features = []
    for t in tracks:
        t.sort()
        if len(t.points) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [round(p["longitude"], 6), round(p["latitude"], 6)]
                        for p in t.points
                    ],
                },
                "properties": {
                    "mmsi": t.mmsi,
                    "name": t.name,
                    "type": t.vessel_type,
                    "synthetic": t.synthetic,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}
