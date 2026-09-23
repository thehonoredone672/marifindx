"""MariFindX FastAPI backend.

    uvicorn backend.main:app --reload

Exposes the trained segmentation model and the drift / AIS / correlation
services over HTTP. Starts successfully even when no checkpoint exists --
/api/model/status reports that honestly and detection endpoints return a
actionable 409 rather than fabricating a prediction.
"""
from __future__ import annotations

import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.config import load_config  # noqa: E402
from services.investigation_service import (  # noqa: E402
    demo_image_path,
    get_investigation,
    list_investigations,
    run_investigation,
)

app = FastAPI(
    title="MariFindX API",
    version="3.0.0",
    description=(
        "AI-powered marine oil-spill detection and vessel attribution. "
        "Outputs are investigative decision support, not determinations of "
        "legal responsibility."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://localhost:5174",
        "http://127.0.0.1:5173", "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CFG = load_config()


def _checkpoint_path() -> Path:
    return CFG.resolve("paths.models_dir") / str(
        CFG.get_path("paths.checkpoint_name", "marifindx_oil_segmentation.pt")
    )


def _require_model() -> None:
    if not _checkpoint_path().exists():
        raise HTTPException(
            status_code=409,
            detail={
                "error": "model_checkpoint_missing",
                "message": "Model checkpoint not found. Run training first.",
                "command": "python -m ml.train --config config.yaml --mode quick",
                "expected_path": str(_checkpoint_path()),
            },
        )


class DetectionRequest(BaseModel):
    image_path: str | None = None
    detection_time: str | None = None
    threshold: float | None = None


class InvestigationRequest(BaseModel):
    image_path: str | None = None
    detection_time: str | None = None
    ais_file: str | None = None
    use_demo: bool = False


def _parse_time(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, f"Unparseable detection_time: {value}")


def _resolve_image(path_str: str | None, use_demo: bool) -> Path:
    if use_demo or not path_str:
        demo = demo_image_path(CFG)
        if demo is None:
            raise HTTPException(
                404,
                {
                    "error": "demo_scene_missing",
                    "message": "No demo scene found under data/demo/.",
                    "command": "python scripts/make_demo_data.py",
                },
            )
        return demo
    p = Path(path_str)
    if not p.is_absolute():
        p = REPO_ROOT / p
    if not p.exists():
        raise HTTPException(404, f"Image not found: {p}")
    return p


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok"}


@app.get("/api/model/status")
def model_status() -> dict[str, Any]:
    ckpt = _checkpoint_path()
    meta_path = CFG.resolve("paths.models_dir") / str(
        CFG.get_path("paths.metadata_name", "model_metadata.json")
    )
    payload: dict[str, Any] = {
        "checkpoint_present": ckpt.exists(),
        "checkpoint_path": str(ckpt),
        "train_command": "python -m ml.train --config config.yaml --mode quick",
    }
    if ckpt.exists():
        payload["size_mb"] = round(ckpt.stat().st_size / 1e6, 2)
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as fh:
                payload["metadata"] = json.load(fh)
        except Exception as exc:
            payload["metadata_error"] = str(exc)

    try:
        import torch

        payload["torch_version"] = torch.__version__
        payload["cuda_available"] = torch.cuda.is_available()
        payload["device"] = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        payload["torch_version"] = None
    return payload


@app.get("/api/model/metrics")
def model_metrics() -> dict[str, Any]:
    path = CFG.resolve("paths.results_dir") / "metrics.json"
    if not path.exists():
        raise HTTPException(
            404,
            {
                "error": "metrics_missing",
                "message": "No test metrics yet.",
                "command": "python -m ml.test --config config.yaml",
            },
        )
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


@app.post("/api/detection/run")
def detection_run(req: DetectionRequest) -> dict[str, Any]:
    _require_model()
    from ml.inference import run_inference

    image = _resolve_image(req.image_path, use_demo=req.image_path is None)
    result = run_inference(image, CFG, threshold=req.threshold)
    result.pop("probability_map", None)
    result.pop("binary_mask", None)
    return result


@app.post("/api/investigation/create")
def investigation_create(req: InvestigationRequest) -> dict[str, Any]:
    _require_model()
    image = _resolve_image(req.image_path, req.use_demo)
    return run_investigation(
        image,
        CFG,
        detection_time=_parse_time(req.detection_time),
        ais_file=req.ais_file,
    )


@app.post("/api/investigation/demo")
def investigation_demo() -> dict[str, Any]:
    """One-click demo: bundled scene + synthetic AIS, no external services."""
    _require_model()
    return run_investigation(
        _resolve_image(None, True), CFG, detection_time=datetime.now(timezone.utc)
    )


@app.post("/api/investigation/upload")
async def investigation_upload(file: UploadFile = File(...)) -> dict[str, Any]:
    _require_model()
    suffix = Path(file.filename or "upload.tif").suffix or ".tif"
    if suffix.lower() not in (".tif", ".tiff"):
        raise HTTPException(400, "Expected a GeoTIFF (.tif/.tiff) Sentinel-1 scene")

    upload_dir = REPO_ROOT / "data" / "processed" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / f"upload_{datetime.now().strftime('%Y%m%d_%H%M%S')}{suffix}"
    with open(dest, "wb") as fh:
        shutil.copyfileobj(file.file, fh)
    return run_investigation(dest, CFG)


@app.get("/api/investigation/list")
def investigation_list() -> dict[str, Any]:
    return {"investigations": list_investigations(CFG)}


@app.get("/api/investigation/{inv_id}")
def investigation_get(inv_id: str) -> dict[str, Any]:
    rec = get_investigation(inv_id, CFG)
    if rec is None:
        raise HTTPException(404, f"Investigation not found: {inv_id}")
    return rec


@app.get("/api/investigation/{inv_id}/result")
def investigation_result(inv_id: str) -> dict[str, Any]:
    """Trimmed payload for the dashboard and 3D scene."""
    rec = get_investigation(inv_id, CFG)
    if rec is None:
        raise HTTPException(404, f"Investigation not found: {inv_id}")
    return {
        "id": rec["id"],
        "status": rec.get("status"),
        "summary": rec.get("summary"),
        "spill": rec.get("spill"),
        "origin": rec.get("origin"),
        "drift": rec.get("drift"),
        "ais": rec.get("ais"),
        "ranking": rec.get("ranking"),
        "simulation": rec.get("simulation"),
        "detection_time": rec.get("detection_time"),
    }


@app.get("/api/investigation/{inv_id}/geojson/{layer}")
def investigation_geojson(inv_id: str, layer: str) -> FileResponse:
    allowed = {"spill", "origin_probability", "drift_path", "ais_tracks"}
    if layer not in allowed:
        raise HTTPException(400, f"Unknown layer '{layer}'. Allowed: {sorted(allowed)}")
    path = (
        CFG.resolve("paths.results_dir") / "investigations" / inv_id / f"{layer}.geojson"
    )
    if not path.exists():
        raise HTTPException(404, f"Layer not available: {layer}")
    return FileResponse(path, media_type="application/geo+json")


@app.post("/api/drift/run")
def drift_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Standalone drift simulation from an explicit origin."""
    from services.drift_service import build_environment, forward_drift_path

    try:
        lon = float(payload["lon"])
        lat = float(payload["lat"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Body must include numeric 'lat' and 'lon'")

    cfg = dict(CFG.get_path("drift", {}))
    for key in ("particles", "integrator", "windage", "timestep_minutes"):
        if key in payload:
            cfg[key] = payload[key]
    hours = float(payload.get("hours", cfg.get("backtrack_hours", 24)))
    return forward_drift_path(
        lon, lat, _parse_time(payload.get("release_time")), hours, cfg,
        env=build_environment(cfg),
    )


@app.post("/api/ais/load")
def ais_load(payload: dict[str, Any]) -> dict[str, Any]:
    """Load AIS from a CSV path, or synthesise around a given origin."""
    from services.ais_service import load_ais

    cfg = dict(CFG.get_path("ais", {}))
    if payload.get("file"):
        cfg["file"] = payload["file"]
        cfg["source"] = "file"
    lon = float(payload.get("lon", 71.9))
    lat = float(payload.get("lat", 19.0))
    tracks, meta = load_ais(cfg, lon, lat, _parse_time(payload.get("release_time")))
    return {
        "meta": meta,
        "count": len(tracks),
        "vessels": [t.to_dict() for t in tracks],
    }


@app.post("/api/correlation/run")
def correlation_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Re-score an existing investigation, optionally with new weights."""
    inv_id = payload.get("investigation_id")
    if not inv_id:
        raise HTTPException(400, "Body must include 'investigation_id'")
    rec = get_investigation(inv_id, CFG)
    if rec is None:
        raise HTTPException(404, f"Investigation not found: {inv_id}")

    from services.ais_service import VesselTrack
    from services.correlation_service import correlate

    corr_cfg = dict(CFG.get_path("correlation", {}))
    if "weights" in payload:
        corr_cfg["weights"] = payload["weights"]

    tracks: list[VesselTrack] = []
    for v in rec["ranking"]["vessels"]:
        t = VesselTrack(v["mmsi"], v["name"], v["type"], synthetic=v.get("synthetic", False))
        for p in v["trajectory"]:
            t.points.append(
                {
                    "timestamp": datetime.fromisoformat(p["time"]),
                    "latitude": p["lat"],
                    "longitude": p["lon"],
                    "sog": p.get("sog", 0.0),
                    "cog": p.get("cog", 0.0),
                    "heading": p.get("heading", 0.0),
                }
            )
        t.sort()
        tracks.append(t)

    return correlate(
        tracks,
        rec["origin"]["origin"],
        rec["origin"]["release_window"],
        corr_cfg,
        slick_orientation_deg=rec["spill"]["geometry"].get("orientation_deg"),
        drift_direction_deg=rec["drift"].get("drift_direction_deg"),
    )


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "name": "MariFindX API",
        "version": "3.0.0",
        "docs": "/docs",
        "health": "/api/health",
        "model_ready": _checkpoint_path().exists(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)
