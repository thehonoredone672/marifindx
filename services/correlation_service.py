"""Vessel-to-spill correlation scoring.

A deliberately TRANSPARENT weighted model:

    S = w1*Proximity + w2*Temporal + w3*Trajectory + w4*Origin + w5*Drift

Every component is bounded to [0,1] and reported alongside the raw
measurement that produced it, so a reviewer can audit why a vessel
ranked where it did rather than trusting an opaque number.

The weights are PROTOTYPE PARAMETERS chosen for a plausible balance of
evidence. They are not empirically calibrated constants and carry no
scientific authority. An optional XGBoost ranker can refine the ordering
when a trained model is present, but the rule-based path below is always
sufficient on its own.

Output is a ranked candidate ASSOCIATION, never a determination of
responsibility.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

from .ais_service import VesselTrack
from .geo_service import haversine_km

DISCLAIMER = (
    "Ranked candidate association produced by a prototype correlation model. "
    "This is investigative decision support, not a determination of legal "
    "responsibility."
)


def _exp_decay(value: float, half: float) -> float:
    """1.0 at value=0, 0.5 at value=half, asymptotically 0."""
    if half <= 0:
        return 0.0
    return float(math.exp(-math.log(2.0) * max(0.0, value) / half))


def _angular_difference(a: float, b: float) -> float:
    d = abs((a - b) % 360.0)
    return min(d, 360.0 - d)


def score_proximity(track: VesselTrack, origin_lon: float, origin_lat: float,
                    half_km: float) -> dict[str, Any]:
    approach = track.closest_approach(origin_lon, origin_lat)
    d = approach["distance_km"]
    return {
        "value": round(_exp_decay(d, half_km), 4),
        "distance_km": round(d, 3) if math.isfinite(d) else None,
        "detail": f"closest AIS report {d:.2f} km from the probable origin",
    }


def score_temporal(track: VesselTrack, window_start: datetime, window_end: datetime,
                   half_hours: float) -> dict[str, Any]:
    """1.0 if the vessel reported inside the release window, decaying outside."""
    if not track.points:
        return {"value": 0.0, "delta_hours": None, "detail": "no AIS reports"}

    inside = [p for p in track.points if window_start <= p["timestamp"] <= window_end]
    if inside:
        return {
            "value": 1.0,
            "delta_hours": 0.0,
            "detail": f"{len(inside)} AIS reports inside the release window",
        }

    first, last = track.points[0]["timestamp"], track.points[-1]["timestamp"]
    gap_h = min(
        abs((window_start - last).total_seconds()),
        abs((first - window_end).total_seconds()),
    ) / 3600.0
    return {
        "value": round(_exp_decay(gap_h, half_hours), 4),
        "delta_hours": round(gap_h, 3),
        "detail": f"nearest AIS report {gap_h:.2f} h outside the release window",
    }


def score_trajectory(track: VesselTrack, origin_lon: float, origin_lat: float,
                     slick_orientation_deg: float | None,
                     tolerance_deg: float) -> dict[str, Any]:
    """Alignment of vessel course with the slick's principal axis.

    A slick trailing a moving vessel should lie roughly along that
    vessel's course, so agreement between the two bearings is evidence.
    The slick axis is undirected (180-degree ambiguity), which is why the
    comparison folds into [0, 90].
    """
    if slick_orientation_deg is None or not track.points:
        return {"value": 0.0, "detail": "slick orientation unavailable"}

    approach = track.closest_approach(origin_lon, origin_lat)
    point = approach.get("point")
    if not point:
        return {"value": 0.0, "detail": "no AIS report available"}

    course = float(point.get("cog") or point.get("heading") or 0.0)
    diff = _angular_difference(course % 180.0, slick_orientation_deg % 180.0)
    diff = min(diff, 180.0 - diff)
    value = max(0.0, 1.0 - diff / max(tolerance_deg, 1e-6))
    return {
        "value": round(min(1.0, value), 4),
        "course_deg": round(course, 1),
        "slick_axis_deg": round(slick_orientation_deg, 1),
        "difference_deg": round(diff, 1),
        "detail": f"course {course:.0f} deg vs slick axis "
                  f"{slick_orientation_deg:.0f} deg ({diff:.0f} deg apart)",
    }


def score_origin_zone(track: VesselTrack, origin_lon: float, origin_lat: float,
                      radius_km: float, window_start: datetime,
                      window_end: datetime) -> dict[str, Any]:
    """Did the vessel actually cross the uncertainty zone during the window?"""
    if radius_km <= 0:
        radius_km = 1.0
    crossings = [
        p for p in track.points
        if window_start <= p["timestamp"] <= window_end
        and haversine_km(p["longitude"], p["latitude"], origin_lon, origin_lat) <= radius_km
    ]
    if crossings:
        dwell_h = (
            crossings[-1]["timestamp"] - crossings[0]["timestamp"]
        ).total_seconds() / 3600.0
        return {
            "value": 1.0,
            "crossed": True,
            "reports_in_zone": len(crossings),
            "dwell_hours": round(dwell_h, 3),
            "detail": f"crossed the origin zone ({len(crossings)} reports, "
                      f"{dwell_h:.2f} h dwell)",
        }

    approach = track.closest_approach(origin_lon, origin_lat)
    d = approach["distance_km"]
    margin = max(0.0, d - radius_km)
    return {
        "value": round(_exp_decay(margin, radius_km), 4),
        "crossed": False,
        "detail": f"did not enter the zone; closest approach {d:.2f} km",
    }


def score_drift_consistency(track: VesselTrack, origin_lon: float, origin_lat: float,
                            drift_direction_deg: float | None) -> dict[str, Any]:
    """Is the vessel positioned up-drift of the slick?

    Oil released by a vessel is carried downstream, so a plausible source
    should sit on the UP-drift side of the observed slick. A vessel
    down-drift of the spill would have had to release oil that travelled
    against the current.
    """
    if drift_direction_deg is None or not track.points:
        return {"value": 0.0, "detail": "drift direction unavailable"}

    approach = track.closest_approach(origin_lon, origin_lat)
    point = approach.get("point")
    if not point:
        return {"value": 0.0, "detail": "no AIS report available"}

    from .geo_service import bearing_deg

    to_origin = bearing_deg(
        point["longitude"], point["latitude"], origin_lon, origin_lat
    )
    diff = _angular_difference(to_origin, drift_direction_deg)
    value = max(0.0, 1.0 - diff / 180.0)
    return {
        "value": round(value, 4),
        "bearing_to_origin_deg": round(to_origin, 1),
        "drift_direction_deg": round(drift_direction_deg, 1),
        "difference_deg": round(diff, 1),
        "detail": f"bearing to origin {to_origin:.0f} deg vs drift "
                  f"{drift_direction_deg:.0f} deg ({diff:.0f} deg apart)",
    }


def correlate(
    tracks: list[VesselTrack],
    origin: dict[str, Any],
    release_window: dict[str, str],
    cfg: dict[str, Any],
    slick_orientation_deg: float | None = None,
    drift_direction_deg: float | None = None,
) -> dict[str, Any]:
    """Score and rank every candidate vessel."""
    weights = cfg.get("weights", {})
    w = {
        "proximity": float(weights.get("proximity", 0.25)),
        "temporal": float(weights.get("temporal", 0.20)),
        "trajectory": float(weights.get("trajectory", 0.20)),
        "origin": float(weights.get("origin", 0.20)),
        "drift": float(weights.get("drift", 0.15)),
    }
    total_w = sum(w.values()) or 1.0

    half_km = float(cfg.get("proximity_half_distance_km", 8.0))
    half_h = float(cfg.get("temporal_half_window_hours", 3.0))
    tol_deg = float(cfg.get("heading_tolerance_deg", 45.0))

    origin_lon = float(origin["lon"])
    origin_lat = float(origin["lat"])
    radius_km = float(origin.get("uncertainty_radius_km", 5.0))

    ws = datetime.fromisoformat(release_window["start"])
    we = datetime.fromisoformat(release_window["end"])

    results = []
    for track in tracks:
        prox = score_proximity(track, origin_lon, origin_lat, half_km)
        temp = score_temporal(track, ws, we, half_h)
        traj = score_trajectory(track, origin_lon, origin_lat, slick_orientation_deg, tol_deg)
        zone = score_origin_zone(track, origin_lon, origin_lat, radius_km, ws, we)
        drift = score_drift_consistency(track, origin_lon, origin_lat, drift_direction_deg)

        score = (
            w["proximity"] * prox["value"]
            + w["temporal"] * temp["value"]
            + w["trajectory"] * traj["value"]
            + w["origin"] * zone["value"]
            + w["drift"] * drift["value"]
        ) / total_w

        payload = track.to_dict()
        payload.update(
            {
                "correlation_score": round(score, 4),
                "evidence": {
                    "spatial_proximity": prox,
                    "temporal_overlap": temp,
                    "trajectory_consistency": traj,
                    "origin_zone": zone,
                    "drift_consistency": drift,
                },
                "distance_km": prox.get("distance_km"),
                "time_difference_hours": temp.get("delta_hours"),
                # Compact 0-1 vector for the UI evidence bars.
                "evidence_vector": [
                    prox["value"], temp["value"], traj["value"],
                    zone["value"], drift["value"],
                ],
            }
        )
        results.append(payload)

    results.sort(key=lambda r: r["correlation_score"], reverse=True)
    for i, r in enumerate(results, start=1):
        r["rank"] = i

    return {
        "vessels": results,
        "weights": w,
        "top_candidate": results[0]["id"] if results else None,
        "method": "transparent weighted rule-based correlation",
        "disclaimer": DISCLAIMER,
        "parameters": {
            "proximity_half_distance_km": half_km,
            "temporal_half_window_hours": half_h,
            "heading_tolerance_deg": tol_deg,
            "origin_radius_km": radius_km,
        },
    }


def build_summary(
    detection: dict[str, Any],
    origin: dict[str, Any],
    release_window: dict[str, str],
    ranking: dict[str, Any],
    ais_meta: dict[str, Any],
) -> str:
    """Compose the narrative summary from structured values only.

    Every number here is read from the computed result -- no language
    model is involved, so the summary cannot drift from the arithmetic.
    """
    geom = detection.get("geometry", {})
    conf = detection.get("confidence", {})

    area = geom.get("area_km2")
    area_txt = f"approximately {area:.1f} km squared" if area else (
        f"{geom.get('area_px', 0)} pixels (no georeferencing available)"
    )
    conf_pct = float(conf.get("score", 0.0)) * 100.0
    orient = geom.get("orientation_deg")
    aspect = geom.get("aspect_ratio")

    parts = [
        f"A {conf_pct:.0f}%-confidence ({conf.get('category', 'UNKNOWN')}) dark-water "
        f"anomaly covering {area_txt} was segmented by the trained model"
    ]
    if orient is not None and aspect is not None and math.isfinite(aspect):
        parts.append(
            f", elongated along a {orient:.0f} degree bearing with an aspect "
            f"ratio of {aspect:.1f}:1"
        )
    parts.append(". ")

    o = origin.get("origin", origin)
    parts.append(
        f"Backward Lagrangian drift modelling places the probable release point "
        f"near {abs(o['lat']):.3f} {'N' if o['lat'] >= 0 else 'S'}, "
        f"{abs(o['lon']):.3f} {'E' if o['lon'] >= 0 else 'W'}, within roughly "
        f"{o.get('uncertainty_radius_km', 0):.1f} km (68% particle containment), "
        f"during a window between {release_window['start'][:16].replace('T', ' ')} "
        f"and {release_window['end'][:16].replace('T', ' ')} UTC. "
    )

    vessels = ranking.get("vessels", [])
    if vessels:
        top = vessels[0]
        label = "synthetic demonstration" if ais_meta.get("synthetic") else "AIS-transmitting"
        parts.append(
            f"Of {len(vessels)} {label} vessels active near the estimated origin "
            f"and time window, {top['name']} ({top['type']}) is the most likely "
            f"associated vessel with a correlation score of "
            f"{top['correlation_score']:.4f}"
        )
        dist = top.get("distance_km")
        dt = top.get("time_difference_hours")
        if dist is not None:
            parts.append(f": it passed within {dist:.2f} km of the estimated origin")
        if dt is not None:
            parts.append(f", {dt:.1f} h from the estimated release time")
        crossed = top["evidence"]["origin_zone"].get("crossed")
        if crossed:
            parts.append(", transiting the origin uncertainty zone during the window")
        parts.append(". ")
    else:
        parts.append("No AIS vessels met the spatial and temporal candidate filters. ")

    if ais_meta.get("synthetic"):
        parts.append(
            "AIS tracks are SYNTHETIC DEMONSTRATION DATA and do not represent "
            "real vessel movements. "
        )
    parts.append(DISCLAIMER)
    return "".join(parts)


def try_ml_ranker(vessels: list[dict[str, Any]], model_path: str | None) -> dict[str, Any] | None:
    """Optional XGBoost refinement. Absent model => rule-based stands."""
    if not model_path:
        return None
    try:
        import json
        from pathlib import Path

        import numpy as np
        import xgboost as xgb
    except Exception:
        return None

    p = Path(model_path)
    if not p.exists():
        return None
    try:
        booster = xgb.Booster()
        booster.load_model(str(p))
        features = np.asarray([v["evidence_vector"] for v in vessels], dtype=np.float32)
        probs = booster.predict(xgb.DMatrix(features))
        return {
            "available": True,
            "probabilities": [float(x) for x in probs],
            "note": "XGBoost association probability (optional refinement layer)",
        }
    except Exception as exc:
        print(f"[correlation] XGBoost ranker unavailable: {exc}")
        return None
