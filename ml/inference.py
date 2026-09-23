"""Inference: SAR GeoTIFF -> probability mask -> georeferenced spill polygon.

    python -m ml.inference --image data/demo/demo_scene.tif

Large scenes are processed by sliding a patch window with overlap and
averaging the probabilities in the seams, which avoids the blocky
discontinuities you get from hard-tiling a segmentation network.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch

from services.geo_service import (
    classify_confidence,
    extract_regions,
    geometry_from_region,
    save_geojson,
    to_geojson,
)

from .config import ensure_dirs, load_config
from .model import build_model
from .preprocessing import (
    ensure_two_channels,
    iter_patch_windows,
    normalise_channels,
    pad_to,
    read_sar_image,
)


class CheckpointMissing(RuntimeError):
    pass


def load_model(cfg, checkpoint: str | Path | None = None, device: str = "cpu"):
    """Load a trained checkpoint. Never silently fabricates a model."""
    ckpt_path = Path(checkpoint) if checkpoint else (
        cfg.resolve("paths.models_dir")
        / str(cfg.get_path("paths.checkpoint_name", "marifindx_oil_segmentation.pt"))
    )
    if not ckpt_path.exists():
        raise CheckpointMissing(
            f"Model checkpoint not found: {ckpt_path}\n"
            "Run training first:\n"
            "    python -m ml.train --config config.yaml --mode quick"
        )

    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    model_cfg = ckpt.get("model_config") or cfg.get_path("model", {})
    model = build_model(model_cfg)
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()
    return model, ckpt, ckpt_path


@torch.no_grad()
def predict_probability(
    model, image: np.ndarray, cfg, device: str = "cpu", patch_size: int | None = None
) -> np.ndarray:
    """Sliding-window probability map, overlap-averaged. Returns [H, W]."""
    patch_cfg = cfg.get_path("patch", {})
    size = int(patch_size or patch_cfg.get("size", 512))
    stride = int(patch_cfg.get("test_stride", size))
    h, w = image.shape[:2]

    prob = np.zeros((h, w), dtype=np.float32)
    weight = np.zeros((h, w), dtype=np.float32)

    for (r, c, ph, pw) in iter_patch_windows(h, w, size, stride):
        patch = image[r : r + ph, c : c + pw]
        padded = pad_to(patch, size, 0.0)
        x = torch.from_numpy(
            np.ascontiguousarray(padded.transpose(2, 0, 1))
        ).float().unsqueeze(0).to(device)
        logits = model(x)
        p = torch.sigmoid(logits)[0, 0].cpu().numpy()
        prob[r : r + ph, c : c + pw] += p[:ph, :pw]
        weight[r : r + ph, c : c + pw] += 1.0

    return prob / np.maximum(weight, 1e-6)


def run_inference(
    image_path: str | Path,
    cfg,
    checkpoint: str | Path | None = None,
    device: str = "cpu",
    threshold: float | None = None,
) -> dict[str, Any]:
    """Full detection pass on a single scene."""
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    model, ckpt, ckpt_path = load_model(cfg, checkpoint, device)

    raw, geo = read_sar_image(image_path)
    img = normalise_channels(ensure_two_channels(raw), cfg.get_path("preprocessing", {}))

    # A checkpoint trained at patch size P should be applied at size P.
    patch_size = int(
        (ckpt.get("patch_config") or {}).get("size", cfg.get_path("patch.size", 512))
    )
    prob = predict_probability(model, img, cfg, device, patch_size=patch_size)

    inf_cfg = dict(cfg.get_path("inference", {}))
    thr = float(threshold if threshold is not None else inf_cfg.get("threshold", 0.5))
    binary = (prob > thr).astype(np.uint8)

    regions = extract_regions(
        binary, prob, min_pixels=int(inf_cfg.get("min_region_pixels", 0))
    )
    transform = geo.get("transform")
    crs = geo.get("crs")

    geometries: list[dict[str, Any]] = []
    for region in regions:
        g = geometry_from_region(region, transform, crs)
        g["confidence"] = classify_confidence(g, inf_cfg)
        geometries.append(g)

    detected = bool(geometries)
    primary = geometries[0] if detected else None

    return {
        "image": str(image_path),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "detected": detected,
        "georeferenced": bool(geo.get("georeferenced")),
        "threshold": thr,
        "probability_map": prob,
        "binary_mask": binary,
        "regions": geometries,
        "primary": primary,
        "geometry": primary or {},
        "confidence": primary.get("confidence", {}) if primary else {
            "score": 0.0,
            "category": "NONE",
            "detail": "no region exceeded the detection threshold",
        },
        "pixel_statistics": {
            "positive_pixels": int(binary.sum()),
            "total_pixels": int(binary.size),
            "positive_fraction": float(binary.mean()),
            "max_probability": float(prob.max()),
            "mean_probability": float(prob.mean()),
        },
        "model": {
            "checkpoint": str(ckpt_path),
            "epoch": ckpt.get("epoch"),
            "architecture": model.describe(),
            "validation_metrics": ckpt.get("metrics", {}),
        },
    }


def save_visualization(result: dict[str, Any], image: np.ndarray, out_path: Path) -> Path | None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as exc:
        print(f"[inference] visualization skipped: {exc}")
        return None

    prob = result["probability_map"]
    binary = result["binary_mask"]

    fig, axes = plt.subplots(1, 4, figsize=(20, 5))
    axes[0].imshow(image[..., 0], cmap="gray")
    axes[0].set_title("VV (normalised)")
    axes[1].imshow(image[..., 1], cmap="gray")
    axes[1].set_title("VH (normalised)")
    im = axes[2].imshow(prob, cmap="inferno", vmin=0, vmax=1)
    axes[2].set_title("Oil probability")
    fig.colorbar(im, ax=axes[2], fraction=0.046)
    axes[3].imshow(image[..., 0], cmap="gray")
    axes[3].imshow(np.ma.masked_where(binary == 0, binary), cmap="autumn", alpha=0.55)
    axes[3].set_title(
        f"Detection ({result['confidence'].get('category', 'NONE')})"
    )
    for ax in axes:
        ax.axis("off")

    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=110, bbox_inches="tight")
    plt.close(fig)
    return out_path


def _json_safe(result: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in result.items() if k not in ("probability_map", "binary_mask")}


def main() -> None:
    ap = argparse.ArgumentParser(description="Run oil-spill inference on a SAR scene")
    ap.add_argument("--image", required=True)
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--threshold", type=float, default=None)
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--outdir", default="results")
    args = ap.parse_args()

    cfg = load_config(args.config)
    device = (
        ("cuda" if torch.cuda.is_available() else "cpu")
        if args.device == "auto" else args.device
    )
    print(f"Device: {device.upper()}")

    try:
        result = run_inference(args.image, cfg, args.checkpoint, device, args.threshold)
    except CheckpointMissing as exc:
        print(f"\n{exc}\n")
        raise SystemExit(2)

    out_root = Path(args.outdir)
    if not out_root.is_absolute():
        from .config import REPO_ROOT

        out_root = REPO_ROOT / out_root
    stem = Path(args.image).stem
    ensure_dirs(
        out_root / "masks", out_root / "polygons",
        out_root / "visualizations", out_root / "metrics",
    )

    np.save(out_root / "masks" / f"{stem}_probability.npy", result["probability_map"])
    try:
        import tifffile

        tifffile.imwrite(
            str(out_root / "masks" / f"{stem}_mask.tif"),
            (result["binary_mask"] * 255).astype(np.uint8),
        )
    except Exception:
        pass

    geojson = to_geojson(
        result["regions"],
        {"source_image": str(args.image), "threshold": result["threshold"]},
    )
    geo_path = save_geojson(out_root / "polygons" / f"{stem}_spill.geojson", geojson)

    raw, _ = read_sar_image(args.image)
    img = normalise_channels(ensure_two_channels(raw), cfg.get_path("preprocessing", {}))
    vis = save_visualization(
        result, img, out_root / "visualizations" / f"{stem}_detection.png"
    )

    json_path = out_root / "metrics" / f"{stem}_detection.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(_json_safe(result), fh, indent=2, default=str)

    print("\n" + "=" * 62)
    print(f"Detected            : {result['detected']}")
    print(f"Regions             : {len(result['regions'])}")
    print(f"Confidence          : {result['confidence'].get('category')} "
          f"({result['confidence'].get('score')})")
    if result["primary"]:
        g = result["primary"]
        if "area_km2" in g:
            print(f"Area                : {g['area_km2']:.3f} km2")
            print(f"Length x Width      : {g.get('length_km', 0):.2f} x "
                  f"{g.get('width_km', 0):.2f} km")
            print(f"Orientation         : {g.get('orientation_deg', 0):.1f} deg")
            print(f"Aspect ratio        : {g.get('aspect_ratio', 0):.2f}:1")
            print(f"Centroid            : {g['centroid']['lat']:.5f}, "
                  f"{g['centroid']['lon']:.5f}")
        else:
            print(f"Area                : {g.get('area_px', 0)} px (not georeferenced)")
    print(f"Georeferenced       : {result['georeferenced']}")
    print("-" * 62)
    print(f"GeoJSON  : {geo_path}")
    print(f"JSON     : {json_path}")
    if vis:
        print(f"Preview  : {vis}")


if __name__ == "__main__":
    main()
