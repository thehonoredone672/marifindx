"""End-to-end investigation orchestration.

Chains the full pipeline:

    SAR scene -> segmentation -> spill geometry -> backward drift ->
    probable origin -> AIS ingestion -> candidate filter -> correlation
    -> ranked association + narrative summary

Every stage writes into one investigation record so the API, dashboard
and 3D time-lapse all read from a single source of truth.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ml.config import REPO_ROOT, load_config

from .ais_service import filter_candidates, load_ais, tracks_to_geojson
from .correlation_service import build_summary, correlate
from .drift_service import build_environment, estimate_origin, forward_drift_path
from .geo_service import points_to_geojson, save_geojson, to_geojson

_STORE: dict[str, dict[str, Any]] = {}


def _utc(dt: datetime | None = None) -> datetime:
    dt = dt or datetime.now(timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def investigations_dir(cfg) -> Path:
    d = cfg.resolve("paths.results_dir") / "investigations"
    d.mkdir(parents=True, exist_ok=True)
    return d


def run_investigation(
    image_path: str | Path,
    cfg=None,
    detection_time: datetime | None = None,
    checkpoint: str | None = None,
    device: str = "cpu",
    ais_file: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Execute the full chain on one scene."""
    from ml.inference import run_inference  # imported late: torch is heavy

    cfg = cfg or load_config()
    detection_time = _utc(detection_time)
    inv_id = f"inv-{uuid.uuid4().hex[:10]}"

    # --- 1. Detection --------------------------------------------------
    detection = run_inference(image_path, cfg, checkpoint, device)
    detection.pop("probability_map", None)
    detection.pop("binary_mask", None)

    if not detection["detected"]:
        record = {
            "id": inv_id,
            "created_utc": _utc().isoformat(),
            "status": "no_detection",
            "image": str(image_path),
            "detection": detection,
            "message": (
                "No region exceeded the detection threshold. Drift and AIS "
                "correlation were not run."
            ),
        }
        _STORE[inv_id] = record
        return record

    geometry = detection["primary"]
    centroid = geometry["centroid"]
    spill_lon, spill_lat = float(centroid["lon"]), float(centroid["lat"])
    polygon = geometry.get("polygon", [])

    # --- 2. Backward drift -> probable origin --------------------------
    drift_cfg = dict(cfg.get_path("drift", {}))
    env = build_environment(drift_cfg)
    origin_result = estimate_origin(
        spill_lon, spill_lat, detection_time, drift_cfg,
        env=env, spill_polygon=polygon,
    )
    origin = origin_result["origin"]
    release_window = origin_result["release_window"]
    release_centre = datetime.fromisoformat(release_window["centre"])

    # --- 3. Forward drift (for the time-lapse) -------------------------
    forward = forward_drift_path(
        origin["lon"], origin["lat"], release_centre,
        float(drift_cfg.get("backtrack_hours", 24)), drift_cfg, env=env,
    )

    # --- 4. AIS ---------------------------------------------------------
    ais_cfg = dict(cfg.get_path("ais", {}))
    if ais_file:
        ais_cfg["file"] = ais_file
        ais_cfg["source"] = "file"
    tracks, ais_meta = load_ais(
        ais_cfg, origin["lon"], origin["lat"], release_centre
    )
    candidates = filter_candidates(
        tracks, origin["lon"], origin["lat"],
        datetime.fromisoformat(release_window["start"]),
        datetime.fromisoformat(release_window["end"]),
        ais_cfg,
    )
    if not candidates:
        candidates = tracks  # report everything rather than an empty table

    # --- 5. Correlation --------------------------------------------------
    ranking = correlate(
        candidates,
        origin,
        release_window,
        dict(cfg.get_path("correlation", {})),
        slick_orientation_deg=geometry.get("orientation_deg"),
        drift_direction_deg=forward.get("drift_direction_deg"),
    )

    summary_text = build_summary(
        detection, origin_result, release_window, ranking, ais_meta
    )

    record = {
        "id": inv_id,
        "created_utc": _utc().isoformat(),
        "status": "complete",
        "image": str(image_path),
        "detection_time": detection_time.isoformat(),
        "detection": detection,
        "spill": {
            "geometry": geometry,
            "confidence": detection["confidence"],
            "regions": len(detection["regions"]),
            "polygon": polygon,
            "centroid": centroid,
        },
        "origin": origin_result,
        "drift": forward,
        "ais": {
            "meta": ais_meta,
            "total_tracks": len(tracks),
            "candidates": len(candidates),
        },
        "ranking": ranking,
        "summary": summary_text,
        "simulation": {
            "start_time": release_window["start"],
            "release_time": release_window["centre"],
            "end_time": detection_time.isoformat(),
            "frame_count": len(forward.get("frames", [])),
        },
    }

    _STORE[inv_id] = record
    if persist:
        _write_artifacts(record, cfg, tracks, origin_result, detection)
    return record


def _write_artifacts(record, cfg, tracks, origin_result, detection) -> None:
    """Persist the investigation and its GeoJSON layers."""
    out = investigations_dir(cfg) / record["id"]
    out.mkdir(parents=True, exist_ok=True)
    try:
        save_geojson(out / "spill.geojson", to_geojson(detection["regions"]))
        save_geojson(
            out / "origin_probability.geojson",
            points_to_geojson(origin_result["particles"]),
        )
        save_geojson(
            out / "drift_path.geojson",
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [
                                [p["lon"], p["lat"]]
                                for p in record["drift"].get("path", [])
                            ],
                        },
                        "properties": {"kind": "drift_centroid_track"},
                    }
                ],
            },
        )
        save_geojson(out / "ais_tracks.geojson", tracks_to_geojson(tracks))
        with open(out / "investigation.json", "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2, default=str)
        record["artifacts_dir"] = str(out)
    except Exception as exc:
        print(f"[investigation] artifact write failed: {exc}")


def get_investigation(inv_id: str, cfg=None) -> dict[str, Any] | None:
    if inv_id in _STORE:
        return _STORE[inv_id]
    cfg = cfg or load_config()
    path = investigations_dir(cfg) / inv_id / "investigation.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as fh:
            record = json.load(fh)
        _STORE[inv_id] = record
        return record
    return None


def list_investigations(cfg=None) -> list[dict[str, Any]]:
    cfg = cfg or load_config()
    seen: dict[str, dict[str, Any]] = {}
    for inv_id, rec in _STORE.items():
        seen[inv_id] = _brief(rec)
    root = investigations_dir(cfg)
    for d in sorted(root.glob("inv-*")):
        if d.name in seen:
            continue
        f = d / "investigation.json"
        if f.exists():
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    seen[d.name] = _brief(json.load(fh))
            except Exception:
                continue
    return sorted(seen.values(), key=lambda r: r.get("created_utc", ""), reverse=True)


def _brief(rec: dict[str, Any]) -> dict[str, Any]:
    top = None
    vessels = rec.get("ranking", {}).get("vessels", [])
    if vessels:
        top = {
            "name": vessels[0]["name"],
            "score": vessels[0]["correlation_score"],
            "type": vessels[0]["type"],
        }
    geom = rec.get("spill", {}).get("geometry", {})
    return {
        "id": rec.get("id"),
        "created_utc": rec.get("created_utc"),
        "status": rec.get("status"),
        "image": Path(rec.get("image", "")).name,
        "confidence": rec.get("spill", {}).get("confidence", {}).get("category"),
        "area_km2": geom.get("area_km2"),
        "top_candidate": top,
        "synthetic_ais": rec.get("ais", {}).get("meta", {}).get("synthetic"),
    }


def demo_image_path(cfg=None) -> Path | None:
    """Locate the bundled demo scene."""
    cfg = cfg or load_config()
    demo_dir = cfg.resolve("data.demo_dir")
    if demo_dir.exists():
        for pattern in ("*.tif", "*.tiff"):
            hits = sorted(p for p in demo_dir.glob(pattern) if "mask" not in p.stem)
            if hits:
                return hits[0]
    test_dir = cfg.resolve("data.test_dir") / "oil" / "images"
    if test_dir.exists():
        hits = sorted(test_dir.glob("*.tif*"))
        if hits:
            return hits[0]
    return None
