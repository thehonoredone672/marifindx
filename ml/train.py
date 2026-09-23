"""Training entry point.

    python -m ml.train --config config.yaml --mode quick

Writes best-Dice and best-IoU checkpoints, a resumable last-epoch
checkpoint, results/training_history.csv and results/training_curve.png.
"""
from __future__ import annotations

import argparse
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Subset

from .config import ensure_dirs, load_config, seed_everything, select_device, REPO_ROOT
from .dataset import (
    SARPatchDataset,
    build_patch_index,
    describe_records,
    discover_images,
    split_records,
)
from .losses import build_loss
from .metrics import MetricAccumulator, confusion_from_tensors
from .model import build_model


def collate(batch):
    return {
        "image": torch.stack([b["image"] for b in batch]),
        "mask": torch.stack([b["mask"] for b in batch]),
        "scenario": [b["scenario"] for b in batch],
    }


def make_loaders(cfg, mode: str, plan):
    limits = cfg.get_path(
        "data.quick_limits" if mode == "quick" else "data.full_limits", {}
    )
    records = discover_images(cfg, "train", limits)
    if not records:
        raise SystemExit(
            "No training images found.\n"
            f"  Looked under: {cfg.resolve('data.root')}\n"
            "  Prepare data first:\n"
            "    python scripts/download_dataset.py --mode quick\n"
            "  or generate a synthetic pipeline-validation set:\n"
            "    python scripts/make_demo_data.py"
        )

    print(f"Images discovered: {describe_records(records)}")
    train_recs, val_recs = split_records(
        records,
        float(cfg.get_path("data.val_fraction", 0.2)),
        int(cfg.get_path("data.split_seed", 1337)),
    )
    print(f"  train images: {describe_records(train_recs)}")
    print(f"  val   images: {describe_records(val_recs)}")

    # Leakage assertion: no scene may appear on both sides of the split.
    overlap = {str(r.image_path) for r in train_recs} & {
        str(r.image_path) for r in val_recs
    }
    assert not overlap, f"image-level leakage detected: {overlap}"

    seed = int(cfg.get_path("training.seed", 1337))
    train_idx = build_patch_index(train_recs, cfg, training=True, seed=seed)
    val_idx = build_patch_index(val_recs, cfg, training=False, seed=seed)
    print(f"  train patches: {len(train_idx)}   val patches: {len(val_idx)}")

    train_ds = SARPatchDataset(train_idx, cfg, augment=True)
    val_ds = SARPatchDataset(val_idx, cfg, augment=False)

    train_ld = DataLoader(
        train_ds,
        batch_size=plan.batch_size,
        shuffle=True,
        num_workers=plan.num_workers,
        pin_memory=plan.pin_memory,
        collate_fn=collate,
        drop_last=False,
    )
    val_ld = DataLoader(
        val_ds,
        batch_size=plan.batch_size,
        shuffle=False,
        num_workers=plan.num_workers,
        pin_memory=plan.pin_memory,
        collate_fn=collate,
    )
    return train_ld, val_ld, describe_records(train_recs), describe_records(val_recs)


def run_epoch(model, loader, criterion, optimizer, plan, scaler, grad_clip, train: bool):
    model.train() if train else model.eval()
    acc = MetricAccumulator()
    total_loss, n_batches = 0.0, 0

    for batch in loader:
        x = batch["image"].to(plan.device, non_blocking=plan.pin_memory)
        y = batch["mask"].to(plan.device, non_blocking=plan.pin_memory)

        with torch.set_grad_enabled(train):
            if plan.use_amp:
                with torch.autocast(device_type="cuda", dtype=torch.float16):
                    logits = model(x)
                    loss, _ = criterion(logits, y)
            else:
                logits = model(x)
                loss, _ = criterion(logits, y)

        if train:
            optimizer.zero_grad(set_to_none=True)
            if plan.use_amp and scaler is not None:
                scaler.scale(loss).backward()
                if grad_clip:
                    scaler.unscale_(optimizer)
                    torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                if grad_clip:
                    torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
                optimizer.step()

        total_loss += float(loss.detach())
        n_batches += 1
        for i, scenario in enumerate(batch["scenario"]):
            acc.update(
                confusion_from_tensors(logits[i : i + 1].detach().float(), y[i : i + 1]),
                scenario=scenario,
            )

    summary = acc.summary()
    return {
        "loss": total_loss / max(1, n_batches),
        "iou": summary["global"]["iou"],
        "dice": summary["global"]["dice"],
        "precision": summary["global"]["precision"],
        "recall": summary["global"]["recall"],
        "summary": summary,
    }


def save_checkpoint(path: Path, model, optimizer, epoch: int, metrics: dict, cfg) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "epoch": epoch,
            "model_state": model.state_dict(),
            "optimizer_state": optimizer.state_dict(),
            "metrics": metrics,
            "model_config": dict(cfg.get_path("model", {})),
            "preprocessing_config": dict(cfg.get_path("preprocessing", {})),
            "patch_config": dict(cfg.get_path("patch", {})),
        },
        path,
    )


def plot_curves(history: list[dict], out_path: Path) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as exc:
        print(f"[train] skipping curve plot: {exc}")
        return

    epochs = [h["epoch"] for h in history]
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    axes[0].plot(epochs, [h["train_loss"] for h in history], label="train")
    axes[0].plot(epochs, [h["val_loss"] for h in history], label="val")
    axes[0].set_title("Loss")
    axes[0].set_xlabel("epoch")
    axes[0].legend()
    axes[0].grid(alpha=0.3)

    axes[1].plot(epochs, [h["val_dice"] for h in history], label="val Dice")
    axes[1].plot(epochs, [h["val_iou"] for h in history], label="val IoU")
    axes[1].set_title("Validation overlap")
    axes[1].set_xlabel("epoch")
    axes[1].legend()
    axes[1].grid(alpha=0.3)

    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser(description="Train the MariFindX segmentation model")
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--mode", choices=["quick", "full"], default="quick")
    ap.add_argument("--epochs", type=int, default=None)
    ap.add_argument("--batch-size", type=int, default=None)
    ap.add_argument("--encoder", default=None)
    ap.add_argument("--patch-size", type=int, default=None)
    ap.add_argument("--cpu", action="store_true", help="force CPU even if CUDA exists")
    ap.add_argument("--resume", default=None, help="checkpoint to resume from")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if args.encoder:
        cfg["model"]["encoder"] = args.encoder
    if args.patch_size:
        cfg["patch"]["size"] = args.patch_size
        cfg["patch"]["stride"] = args.patch_size

    seed_everything(int(cfg.get_path("training.seed", 1337)))
    plan = select_device(cfg, force_cpu=args.cpu)
    if args.batch_size:
        plan.batch_size = args.batch_size

    epochs = args.epochs or int(cfg.get_path("training.epochs", 20))
    results_dir = cfg.resolve("paths.results_dir")
    models_dir = cfg.resolve("paths.models_dir")
    ensure_dirs(results_dir, models_dir)

    print("=" * 68)
    print(f"MariFindX training  |  mode={args.mode}  epochs={epochs}")
    print(plan.describe())
    print("=" * 68)

    train_ld, val_ld, train_desc, val_desc = make_loaders(cfg, args.mode, plan)

    model = build_model(cfg.get_path("model", {})).to(plan.device)
    print(f"Model: {json.dumps(model.describe())}")

    criterion = build_loss(cfg.get_path("loss", {})).to(plan.device)
    lr = float(cfg.get_path("training.learning_rate", 3e-4))
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr,
        weight_decay=float(cfg.get_path("training.weight_decay", 1e-4)),
    )

    sched_name = str(cfg.get_path("training.scheduler", "cosine"))
    if sched_name == "cosine":
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    elif sched_name == "plateau":
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode="max", factor=0.5, patience=3
        )
    else:
        scheduler = None

    scaler = torch.amp.GradScaler("cuda") if plan.use_amp else None
    start_epoch = 1
    if args.resume:
        ckpt = torch.load(args.resume, map_location=plan.device, weights_only=False)
        model.load_state_dict(ckpt["model_state"])
        optimizer.load_state_dict(ckpt["optimizer_state"])
        start_epoch = int(ckpt.get("epoch", 0)) + 1
        print(f"Resumed from {args.resume} at epoch {start_epoch}")

    es_cfg = cfg.get_path("training.early_stopping", {})
    es_enabled = bool(es_cfg.get("enabled", True))
    patience = int(es_cfg.get("patience", 6))
    monitor = str(es_cfg.get("monitor", "val_dice"))
    grad_clip = float(cfg.get_path("training.grad_clip", 0.0))

    history: list[dict] = []
    best = {"dice": -1.0, "iou": -1.0, "loss": float("inf")}
    best_epoch, stale = 0, 0
    ckpt_name = str(cfg.get_path("paths.checkpoint_name", "marifindx_oil_segmentation.pt"))

    for epoch in range(start_epoch, epochs + 1):
        t0 = time.time()
        tr = run_epoch(model, train_ld, criterion, optimizer, plan, scaler, grad_clip, True)
        va = run_epoch(model, val_ld, criterion, optimizer, plan, scaler, grad_clip, False)
        cur_lr = optimizer.param_groups[0]["lr"]

        if scheduler is not None:
            if sched_name == "plateau":
                scheduler.step(va["dice"] if va["dice"] == va["dice"] else 0.0)
            else:
                scheduler.step()

        elapsed = time.time() - t0
        print(
            f"epoch {epoch:3d}/{epochs}  "
            f"train_loss {tr['loss']:.4f}  val_loss {va['loss']:.4f}  "
            f"IoU {va['iou']:.4f}  Dice {va['dice']:.4f}  "
            f"P {va['precision']:.4f}  R {va['recall']:.4f}  "
            f"lr {cur_lr:.2e}  {elapsed:.1f}s"
        )

        history.append(
            {
                "epoch": epoch,
                "train_loss": tr["loss"],
                "val_loss": va["loss"],
                "train_dice": tr["dice"],
                "val_dice": va["dice"],
                "val_iou": va["iou"],
                "val_precision": va["precision"],
                "val_recall": va["recall"],
                "lr": cur_lr,
                "seconds": elapsed,
            }
        )

        improved = False
        if va["dice"] == va["dice"] and va["dice"] > best["dice"]:
            best["dice"] = va["dice"]
            save_checkpoint(models_dir / ckpt_name, model, optimizer, epoch, va, cfg)
            improved = improved or monitor == "val_dice"
        if va["iou"] == va["iou"] and va["iou"] > best["iou"]:
            best["iou"] = va["iou"]
            save_checkpoint(
                models_dir / "best_iou.pt", model, optimizer, epoch, va, cfg
            )
            improved = improved or monitor == "val_iou"
        if va["loss"] < best["loss"]:
            best["loss"] = va["loss"]
            improved = improved or monitor == "val_loss"

        save_checkpoint(models_dir / "last.pt", model, optimizer, epoch, va, cfg)

        if improved:
            best_epoch, stale = epoch, 0
        else:
            stale += 1
            if es_enabled and stale >= patience:
                print(f"Early stopping at epoch {epoch} (no {monitor} gain in {patience})")
                break

    hist_path = results_dir / "training_history.csv"
    with open(hist_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(history[0].keys()))
        writer.writeheader()
        writer.writerows(history)
    plot_curves(history, results_dir / "training_curve.png")

    metadata = {
        "model_name": "marifindx_oil_segmentation",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "training_mode": args.mode,
        "architecture": model.describe(),
        "patch_size": int(cfg.get_path("patch.size", 512)),
        "channels": cfg.get_path("preprocessing.channels", ["VV", "VH"]),
        "device": plan.device.type,
        "epochs_run": len(history),
        "best_epoch": best_epoch,
        "validation_metrics": {
            "best_dice": best["dice"],
            "best_iou": best["iou"],
            "best_loss": best["loss"],
        },
        "test_metrics": None,  # filled in by ml.test
        "train_images": train_desc,
        "val_images": val_desc,
        "config": {
            "loss": dict(cfg.get_path("loss", {})),
            "training": dict(cfg.get_path("training", {})),
            "patch": dict(cfg.get_path("patch", {})),
        },
    }
    manifest = cfg.resolve("data.root") / "SYNTHETIC_MANIFEST.json"
    if manifest.exists():
        metadata["data_provenance"] = {
            "synthetic": True,
            "warning": (
                "Trained on SYNTHETIC pipeline-validation scenes, not real "
                "Sentinel-1 data. These metrics demonstrate that the training "
                "code runs correctly; they are NOT oil-spill detection "
                "performance figures."
            ),
        }
    else:
        metadata["data_provenance"] = {"synthetic": False, "source": "user-provided"}

    meta_path = models_dir / str(cfg.get_path("paths.metadata_name", "model_metadata.json"))
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(metadata, fh, indent=2)

    print("-" * 68)
    print(f"Best val Dice {best['dice']:.4f} | IoU {best['iou']:.4f} (epoch {best_epoch})")
    print(f"Checkpoint : {models_dir / ckpt_name}")
    print(f"Metadata   : {meta_path}")
    print(f"History    : {hist_path}")


if __name__ == "__main__":
    main()
