"""Held-out evaluation on the Part III test split.

    python -m ml.test --config config.yaml

Reports IoU / Dice / Precision / Recall / F1 broken out per scenario
(oil, look-alike, no-oil) plus scene-level detection rates, because the
look-alike false-alarm rate is the number that actually distinguishes a
useful SAR oil detector from one that flags every dark patch.

This split is for final reporting only -- never tune against it.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

from services.geo_service import extract_regions

from .config import ensure_dirs, load_config
from .dataset import LOOKALIKE, NOOIL, OIL, discover_images
from .inference import CheckpointMissing, load_model, predict_probability
from .metrics import MetricAccumulator, confusion_from_arrays
from .preprocessing import (
    ensure_two_channels,
    normalise_channels,
    read_mask,
    read_sar_image,
)


def save_qualitative(image, truth, pred, prob, title, out_path: Path) -> bool:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return False

    fig, axes = plt.subplots(1, 4, figsize=(19, 4.8))
    axes[0].imshow(image[..., 0], cmap="gray")
    axes[0].set_title("Input SAR (VV)")
    axes[1].imshow(truth, cmap="gray", vmin=0, vmax=1)
    axes[1].set_title("Ground truth")
    axes[2].imshow(prob, cmap="inferno", vmin=0, vmax=1)
    axes[2].set_title("Predicted probability")
    axes[3].imshow(image[..., 0], cmap="gray")
    overlay = np.zeros((*truth.shape, 4))
    overlay[(truth > 0) & (pred > 0)] = [0.1, 0.9, 0.1, 0.55]   # TP green
    overlay[(truth == 0) & (pred > 0)] = [1.0, 0.25, 0.1, 0.55]  # FP red
    overlay[(truth > 0) & (pred == 0)] = [0.1, 0.4, 1.0, 0.55]   # FN blue
    axes[3].imshow(overlay)
    axes[3].set_title("TP green / FP red / FN blue")
    for ax in axes:
        ax.axis("off")
    fig.suptitle(title, fontsize=11)
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=100, bbox_inches="tight")
    plt.close(fig)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="Evaluate on the held-out test split")
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--threshold", type=float, default=None)
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--max-qualitative", type=int, default=20)
    args = ap.parse_args()

    cfg = load_config(args.config)
    device = (
        ("cuda" if torch.cuda.is_available() else "cpu")
        if args.device == "auto" else args.device
    )
    print(f"Device: {device.upper()}")

    try:
        model, ckpt, ckpt_path = load_model(cfg, args.checkpoint, device)
    except CheckpointMissing as exc:
        print(f"\n{exc}\n")
        raise SystemExit(2)
    print(f"Checkpoint: {ckpt_path} (epoch {ckpt.get('epoch')})")

    records = discover_images(cfg, "test")
    if not records:
        raise SystemExit(
            f"No test images under {cfg.resolve('data.test_dir')}.\n"
            "Expected per-scenario subdirectories: oil/ lookalike/ nooil/"
        )
    print(f"Test scenes: {len(records)}")

    thr = float(
        args.threshold if args.threshold is not None
        else cfg.get_path("inference.threshold", 0.5)
    )
    min_px = int(cfg.get_path("inference.min_region_pixels", 0))
    patch_size = int(
        (ckpt.get("patch_config") or {}).get("size", cfg.get_path("patch.size", 512))
    )

    results_dir = cfg.resolve("paths.results_dir")
    qual_dir = results_dir / "qualitative"
    ensure_dirs(results_dir, qual_dir)

    acc = MetricAccumulator()
    per_scene = []
    saved_qual = 0

    for i, rec in enumerate(records, start=1):
        raw, _ = read_sar_image(rec.image_path)
        img = normalise_channels(
            ensure_two_channels(raw), cfg.get_path("preprocessing", {})
        )
        prob = predict_probability(model, img, cfg, device, patch_size=patch_size)
        pred = (prob > thr).astype(np.uint8)

        if rec.scenario == OIL and rec.mask_path and Path(rec.mask_path).exists():
            truth = read_mask(rec.mask_path)
            if truth.shape != pred.shape:
                truth = np.zeros_like(pred)
        else:
            # Look-alike and clean scenes contain no oil by definition, so
            # every positive pixel here is a false alarm.
            truth = np.zeros_like(pred)

        counts = confusion_from_arrays(pred, truth)
        regions = extract_regions(pred, prob, min_pixels=min_px)
        flagged = len(regions) > 0

        acc.update(
            counts,
            scenario=rec.scenario,
            scene_has_oil=(rec.scenario == OIL),
            scene_flagged=flagged,
        )
        per_scene.append(
            {
                "image": rec.image_path.name,
                "scenario": rec.scenario,
                "flagged": flagged,
                "regions": len(regions),
                "iou": counts.iou,
                "dice": counts.dice,
                "precision": counts.precision,
                "recall": counts.recall,
                "positive_pixels": int(pred.sum()),
            }
        )

        if saved_qual < args.max_qualitative:
            title = (
                f"{rec.image_path.name}  [{rec.scenario}]  "
                f"IoU={counts.iou:.3f} Dice={counts.dice:.3f}"
            )
            if save_qualitative(
                img, truth, pred, prob, title,
                qual_dir / f"{rec.scenario}_{rec.image_path.stem}.png",
            ):
                saved_qual += 1

        if i % 5 == 0 or i == len(records):
            print(f"  evaluated {i}/{len(records)}")

    summary = acc.summary()
    g = summary["global"]

    print("\n" + "=" * 68)
    print("TEST RESULTS (held-out split)")
    print("=" * 68)
    print(f"{'metric':<14}{'value':>10}")
    for k in ("iou", "dice", "precision", "recall", "f1"):
        v = g[k]
        print(f"{k:<14}{v:>10.4f}" if v == v else f"{k:<14}{'n/a':>10}")

    print("\nPer scenario (pixel level)")
    print(f"{'scenario':<12}{'IoU':>9}{'Dice':>9}{'Precision':>11}{'Recall':>9}")
    for name in (OIL, LOOKALIKE, NOOIL):
        if name not in summary["per_class"]:
            continue
        c = summary["per_class"][name]
        def f(x):
            return f"{x:>9.4f}" if x == x else f"{'n/a':>9}"
        print(f"{name:<12}{f(c['iou'])}{f(c['dice'])}"
              f"{f(c['precision']).rjust(11)}{f(c['recall'])}")

    det = summary.get("detection", {})
    if det:
        print("\nScene-level detection")
        for key in ("scenes", "sensitivity", "specificity",
                    "false_positive_rate", "false_negative_rate"):
            if key in det:
                v = det[key]
                print(f"  {key:<22}{v:.4f}" if isinstance(v, float) else f"  {key:<22}{v}")
        for key in sorted(det):
            if key.endswith("_false_alarm_rate") or key.endswith("_detection_rate"):
                print(f"  {key:<28}{det[key]:.4f}")

    meta_path = cfg.resolve("paths.models_dir") / str(
        cfg.get_path("paths.metadata_name", "model_metadata.json")
    )
    provenance = {}
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as fh:
                meta = json.load(fh)
            provenance = meta.get("data_provenance", {})
            meta["test_metrics"] = {
                "global": g,
                "per_class": summary["per_class"],
                "detection": det,
            }
            with open(meta_path, "w", encoding="utf-8") as fh:
                json.dump(meta, fh, indent=2)
        except Exception as exc:
            print(f"[test] could not update metadata: {exc}")

    payload = {
        "evaluated_utc": datetime.now(timezone.utc).isoformat(),
        "checkpoint": str(ckpt_path),
        "threshold": thr,
        "device": device,
        "scene_count": len(records),
        "summary": summary,
        "per_scene": per_scene,
        "data_provenance": provenance,
    }
    out_path = results_dir / "metrics.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)

    print(f"\nMetrics    : {out_path}")
    print(f"Qualitative: {qual_dir} ({saved_qual} figures)")
    if provenance.get("synthetic"):
        print("\n" + "!" * 68)
        print("These metrics come from SYNTHETIC pipeline-validation scenes.")
        print("They demonstrate the code path works; they are NOT real")
        print("oil-spill detection performance figures.")
        print("!" * 68)


if __name__ == "__main__":
    main()
