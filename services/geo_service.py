"""Mask -> polygon -> geographic coordinates, plus spill geometry.

Per the Zenodo documentation the ground-truth MASKS are not georeferenced
while the Sentinel-1 IMAGES are. So georeferencing is taken exclusively
from the source image's affine transform + CRS, and the predicted mask is
treated as a plain pixel matrix that inherits that transform.

Area is computed in an equal-area projection (auto-selected UTM zone, or
an azimuthal equal-area fallback). Treating degrees as metres would
overstate area badly away from the equator -- at 19 deg N a degree of
longitude is ~105 km, not 111 km, and the error compounds with latitude.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np

try:
    import cv2

    HAS_CV2 = True
except Exception:
    HAS_CV2 = False

try:
    from pyproj import CRS, Transformer

    HAS_PYPROJ = True
except Exception:
    HAS_PYPROJ = False

try:
    from shapely.geometry import Polygon, mapping
    from shapely.ops import transform as shapely_transform

    HAS_SHAPELY = True
except Exception:
    HAS_SHAPELY = False


def pixel_to_geo(transform, col: float, row: float) -> tuple[float, float]:
    """Apply a rasterio affine transform to a pixel centre -> (lon, lat)."""
    if transform is None:
        return float(col), float(row)
    x, y = transform * (col + 0.5, row + 0.5)
    return float(x), float(y)


def _utm_crs_for(lon: float, lat: float):
    zone = int((lon + 180.0) / 6.0) + 1
    epsg = 32600 + zone if lat >= 0 else 32700 + zone
    return CRS.from_epsg(epsg)


def _equal_area_crs_for(lon: float, lat: float):
    """UTM when the geometry sits inside a zone; LAEA otherwise."""
    try:
        return _utm_crs_for(lon, lat)
    except Exception:
        return CRS.from_proj4(
            f"+proj=laea +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs"
        )


def extract_regions(
    mask: np.ndarray, probability: np.ndarray | None = None, min_pixels: int = 0
) -> list[dict[str, Any]]:
    """Connected components -> contours, with per-region probability stats."""
    binary = (mask > 0).astype(np.uint8)
    regions: list[dict[str, Any]] = []

    if HAS_CV2:
        n_labels, labels = cv2.connectedComponents(binary, connectivity=8)
        for label in range(1, n_labels):
            comp = (labels == label).astype(np.uint8)
            pixel_count = int(comp.sum())
            if pixel_count < min_pixels:
                continue
            contours, _ = cv2.findContours(
                comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if not contours:
                continue
            contour = max(contours, key=cv2.contourArea)
            if len(contour) < 3:
                continue
            eps = 0.002 * cv2.arcLength(contour, True)
            contour = cv2.approxPolyDP(contour, eps, True)
            if len(contour) < 3:
                continue

            pts = [(float(p[0][0]), float(p[0][1])) for p in contour]
            region = {"pixel_polygon": pts, "pixel_count": pixel_count}

            if len(contour) >= 5:
                (cx, cy), (w, h), angle = cv2.fitEllipse(contour)
                region["ellipse"] = {
                    "center_px": [float(cx), float(cy)],
                    "major_px": float(max(w, h)),
                    "minor_px": float(min(w, h)),
                    "orientation_deg": float(angle),
                }
            region["perimeter_px"] = float(cv2.arcLength(contour, True))
            x, y, bw, bh = cv2.boundingRect(contour)
            region["bbox_px"] = [int(x), int(y), int(bw), int(bh)]
            m = cv2.moments(comp, binaryImage=True)
            if m["m00"] > 0:
                region["centroid_px"] = [m["m10"] / m["m00"], m["m01"] / m["m00"]]
            else:
                region["centroid_px"] = [float(x + bw / 2), float(y + bh / 2)]

            if probability is not None:
                vals = probability[comp > 0]
                if vals.size:
                    region["probability"] = {
                        "mean": float(vals.mean()),
                        "max": float(vals.max()),
                        "p90": float(np.percentile(vals, 90)),
                        "std": float(vals.std()),
                    }
            regions.append(region)
    else:
        ys, xs = np.nonzero(binary)
        if xs.size >= max(min_pixels, 3):
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            regions.append(
                {
                    "pixel_polygon": [
                        (float(x0), float(y0)),
                        (float(x1), float(y0)),
                        (float(x1), float(y1)),
                        (float(x0), float(y1)),
                    ],
                    "pixel_count": int(binary.sum()),
                    "centroid_px": [float(xs.mean()), float(ys.mean())],
                    "bbox_px": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
                }
            )

    regions.sort(key=lambda r: r["pixel_count"], reverse=True)
    return regions


def geometry_from_region(
    region: dict[str, Any], transform=None, crs=None
) -> dict[str, Any]:
    """Convert one pixel-space region into geographic geometry + metrics."""
    pixel_poly = region["pixel_polygon"]
    georeferenced = transform is not None and crs is not None

    coords = [pixel_to_geo(transform, c, r) for (c, r) in pixel_poly] if georeferenced \
        else [(float(c), float(r)) for (c, r) in pixel_poly]
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])

    cx_px, cy_px = region.get("centroid_px", [0.0, 0.0])
    centroid = pixel_to_geo(transform, cx_px, cy_px) if georeferenced else (cx_px, cy_px)

    out: dict[str, Any] = {
        "georeferenced": bool(georeferenced),
        "crs": str(crs) if georeferenced else "pixel",
        "polygon": [[float(x), float(y)] for x, y in coords],
        "centroid": {"lon": float(centroid[0]), "lat": float(centroid[1])},
        "pixel_count": int(region.get("pixel_count", 0)),
    }
    if "probability" in region:
        out["probability"] = region["probability"]

    if georeferenced and HAS_SHAPELY and HAS_PYPROJ and len(coords) >= 4:
        try:
            poly = Polygon(coords)
            if not poly.is_valid:
                poly = poly.buffer(0)
            src = CRS.from_user_input(str(crs))
            metric = _equal_area_crs_for(centroid[0], centroid[1])
            fwd = Transformer.from_crs(src, metric, always_xy=True).transform
            projected = shapely_transform(fwd, poly)

            area_m2 = float(abs(projected.area))
            out["area_km2"] = area_m2 / 1e6
            out["perimeter_km"] = float(projected.length) / 1000.0
            out["projected_crs"] = metric.to_string()

            rect = projected.minimum_rotated_rectangle
            rx, ry = rect.exterior.coords.xy
            edges = [
                math.dist((rx[i], ry[i]), (rx[i + 1], ry[i + 1])) for i in range(4)
            ]
            major_m, minor_m = max(edges), min(edges)
            out["length_km"] = major_m / 1000.0
            out["width_km"] = minor_m / 1000.0
            out["aspect_ratio"] = float(major_m / minor_m) if minor_m > 1e-6 else float("inf")

            # Orientation of the long axis, degrees clockwise from north.
            i_major = int(np.argmax(edges))
            dx = rx[i_major + 1] - rx[i_major]
            dy = ry[i_major + 1] - ry[i_major]
            bearing = (math.degrees(math.atan2(dx, dy)) + 360.0) % 180.0
            out["orientation_deg"] = float(bearing)

            minx, miny, maxx, maxy = poly.bounds
            out["bbox"] = {
                "min_lon": float(minx),
                "min_lat": float(miny),
                "max_lon": float(maxx),
                "max_lat": float(maxy),
            }
        except Exception as exc:
            out["geometry_error"] = str(exc)

    if "area_km2" not in out:
        # Pixel-space fallback so the field always exists downstream.
        ell = region.get("ellipse", {})
        out["area_px"] = int(region.get("pixel_count", 0))
        if ell:
            out["aspect_ratio"] = float(
                ell["major_px"] / max(ell["minor_px"], 1e-6)
            )
            out["orientation_deg"] = float(ell["orientation_deg"])
    return out


def classify_confidence(geometry: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Aggregate region statistics into a confidence band.

    Deliberately NOT max(probability): a single saturated pixel should not
    certify a whole scene. The mean over the predicted region is the
    primary signal, nudged by the 90th percentile so a region that is
    confident throughout outranks one that is confident only at its core.
    """
    prob = geometry.get("probability", {})
    mean_p = float(prob.get("mean", 0.0))
    p90 = float(prob.get("p90", mean_p))
    score = 0.7 * mean_p + 0.3 * p90

    conf_cfg = cfg.get("confidence", {})
    high = float(conf_cfg.get("high", 0.75))
    medium = float(conf_cfg.get("medium", 0.55))
    category = "HIGH" if score >= high else "MEDIUM" if score >= medium else "LOW"

    result = {
        "score": round(score, 4),
        "category": category,
        "mean_probability": round(mean_p, 4),
        "max_probability": round(float(prob.get("max", 0.0)), 4),
        "p90_probability": round(p90, 4),
        "thresholds": {"high": high, "medium": medium},
    }

    guard = cfg.get("lookalike_guard", {})
    if guard.get("enabled", True):
        reasons = []
        if mean_p < float(guard.get("min_mean_probability", 0.45)):
            reasons.append("mean probability below look-alike guard threshold")
        ar = geometry.get("aspect_ratio")
        if ar is not None and np.isfinite(ar) and ar > float(guard.get("max_aspect_ratio", 40.0)):
            reasons.append("extreme aspect ratio consistent with a linear artefact")
        area = geometry.get("area_km2")
        if area is not None and area < float(guard.get("min_area_km2", 0.05)):
            reasons.append("area below minimum reportable spill size")
        result["lookalike_flags"] = reasons
        result["passes_lookalike_guard"] = not reasons
        if reasons and category == "HIGH":
            result["category"] = "MEDIUM"
    return result


def to_geojson(
    geometries: list[dict[str, Any]], properties: dict[str, Any] | None = None
) -> dict[str, Any]:
    features = []
    for i, geom in enumerate(geometries):
        props = {"region_index": i, "pixel_count": geom.get("pixel_count")}
        for key in ("area_km2", "length_km", "width_km", "aspect_ratio",
                    "orientation_deg", "perimeter_km", "confidence"):
            if key in geom:
                props[key] = geom[key]
        if properties:
            props.update(properties)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [geom["polygon"]]},
                "properties": props,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def save_geojson(path: str | Path, collection: dict[str, Any]) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(collection, fh, indent=2)
    return path


def points_to_geojson(
    points: list[dict[str, Any]], geom_type: str = "Point"
) -> dict[str, Any]:
    features = []
    for p in points:
        coords = [float(p["lon"]), float(p["lat"])]
        props = {k: v for k, v in p.items() if k not in ("lon", "lat")}
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": geom_type, "coordinates": coords},
                "properties": props,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def offset_km(lon: float, lat: float, east_km: float, north_km: float):
    """Local flat-earth offset -- fine at the few-km scale used for drift."""
    dlat = north_km / 110.574
    dlon = east_km / (111.320 * max(math.cos(math.radians(lat)), 1e-6))
    return lon + dlon, lat + dlat
