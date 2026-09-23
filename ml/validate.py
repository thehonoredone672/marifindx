"""Validation-split evaluation (patch level).

    python -m ml.validate --config config.yaml

Uses the same image-level split as training so the reported numbers
correspond to the checkpoint-selection metric. For final reporting on
the untouched Part III split use `python -m ml.test` instead.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from .config import load_config, select_device
from .dataset import (
    SARPatchDataset,
    build_patch_index,
    describe_records,
    discover_images,
    split_records,
)
from .inference import CheckpointMissing, load_model
from .metrics import MetricAccumulator, confusion_from_tensors
from .train import collate


def main() -> None:
    ap = argparse.ArgumentParser(description="Evaluate on the validation split")
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--mode", choices=["quick", "full"], default="quick")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--cpu", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    plan = select_device(cfg, force_cpu=args.cpu)
    print(plan.describe())

    try:
        model, ckpt, ckpt_path = load_model(cfg, args.checkpoint, plan.device.type)
    except CheckpointMissing as exc:
        print(f"\n{exc}\n")
        raise SystemExit(2)
    print(f"Checkpoint: {ckpt_path} (epoch {ckpt.get('epoch')})")

    limits = cfg.get_path(
        "data.quick_limits" if args.mode == "quick" else "data.full_limits", {}
    )
    records = discover_images(cfg, "train", limits)
    if not records:
        raise SystemExit(f"No images under {cfg.resolve('data.root')}")

    _, val_recs = split_records(
        records,
        float(cfg.get_path("data.val_fraction", 0.2)),
        int(cfg.get_path("data.split_seed", 1337)),
    )
    print(f"Validation images: {describe_records(val_recs)}")

    patches = build_patch_index(
        val_recs, cfg, training=False, seed=int(cfg.get_path("training.seed", 1337))
    )
    loader = DataLoader(
        SARPatchDataset(patches, cfg, augment=False),
        batch_size=plan.batch_size,
        shuffle=False,
        num_workers=plan.num_workers,
        collate_fn=collate,
    )

    acc = MetricAccumulator()
    model.eval()
    with torch.no_grad():
        for batch in loader:
            x = batch["image"].to(plan.device)
            y = batch["mask"].to(plan.device)
            logits = model(x)
            for i, scenario in enumerate(batch["scenario"]):
                acc.update(
                    confusion_from_tensors(
                        logits[i : i + 1], y[i : i + 1], args.threshold
                    ),
                    scenario=scenario,
                )

    summary = acc.summary()
    g = summary["global"]
    print("\n" + "=" * 60)
    print("VALIDATION RESULTS")
    print("=" * 60)
    for k in ("iou", "dice", "precision", "recall", "f1"):
        v = g[k]
        print(f"  {k:<12}{v:.4f}" if v == v else f"  {k:<12}n/a")

    print("\nPer scenario")
    for name, c in sorted(summary["per_class"].items()):
        iou, dice = c["iou"], c["dice"]
        print(
            f"  {name:<12}IoU {iou:.4f}  Dice {dice:.4f}"
            if iou == iou else f"  {name:<12}IoU n/a     Dice n/a"
        )

    out = cfg.resolve("paths.results_dir") / "validation_metrics.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(
            {"checkpoint": str(ckpt_path), "threshold": args.threshold,
             "summary": summary}, fh, indent=2,
        )
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    main()
