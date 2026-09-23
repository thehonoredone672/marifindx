"""Dataset and patch indexing for the Zenodo Sentinel-1 oil-spill corpus.

Leakage control (§8): the train/val split is drawn over whole IMAGES and
only then expanded into patches, so no two patches cut from the same
scene can straddle the split. Part III is never touched during training.

Patch extraction is lazy -- the index stores (image_path, window) tuples
and pixels are read on demand, with a small LRU cache so neighbouring
patches from one scene do not trigger repeated full-image reads.
"""
from __future__ import annotations

import random
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch.utils.data import Dataset

from .preprocessing import (
    ensure_two_channels,
    iter_patch_windows,
    normalise_channels,
    pad_to,
    read_mask,
    read_sar_image,
    valid_fraction,
)

# Scenario labels. Only OIL contributes positive pixels; look-alikes and
# clean water are negatives, which is what teaches the model that "dark"
# alone is not oil.
OIL, LOOKALIKE, NOOIL = "oil", "lookalike", "nooil"


@dataclass
class ImageRecord:
    image_path: Path
    mask_path: Path | None
    scenario: str

    @property
    def has_oil(self) -> bool:
        return self.scenario == OIL


@dataclass
class PatchRef:
    record: ImageRecord
    row: int
    col: int
    height: int
    width: int


class _ImageCache:
    """Tiny LRU cache of decoded (image, mask) pairs."""

    def __init__(self, capacity: int = 4):
        self.capacity = max(1, capacity)
        self._store: OrderedDict[str, tuple[np.ndarray, np.ndarray]] = OrderedDict()

    def get(self, key: str):
        if key in self._store:
            self._store.move_to_end(key)
            return self._store[key]
        return None

    def put(self, key: str, value) -> None:
        self._store[key] = value
        self._store.move_to_end(key)
        while len(self._store) > self.capacity:
            self._store.popitem(last=False)


def _match_masks(image_dir: Path, mask_dir: Path, pattern: str) -> list[tuple[Path, Path | None]]:
    """Pair images to masks by filename stem."""
    images = sorted(image_dir.glob(pattern)) if image_dir.exists() else []
    pairs: list[tuple[Path, Path | None]] = []
    mask_lookup: dict[str, Path] = {}
    if mask_dir.exists():
        for m in mask_dir.glob(pattern):
            mask_lookup[m.stem] = m
            mask_lookup[m.stem.replace("_mask", "")] = m

    for img in images:
        mask = mask_lookup.get(img.stem) or mask_lookup.get(f"{img.stem}_mask")
        pairs.append((img, mask))
    return pairs


def discover_images(cfg, split: str = "train", limits: dict | None = None) -> list[ImageRecord]:
    """Scan configured directories and build the image inventory.

    `split="test"` reads the Part III layout, which nests one
    subdirectory per scenario.
    """
    data = cfg.get_path("data", {})
    pattern = data.get("image_glob", "*.tif*")
    img_sub = data.get("image_subdir", "images")
    msk_sub = data.get("mask_subdir", "masks")
    records: list[ImageRecord] = []

    def collect(base: Path, scenario: str, limit: int | None) -> None:
        if not base.exists():
            return
        image_dir = base / img_sub if (base / img_sub).exists() else base
        mask_dir = base / msk_sub if (base / msk_sub).exists() else base
        pairs = _match_masks(image_dir, mask_dir, pattern)
        if limit:
            pairs = pairs[:limit]
        for img, mask in pairs:
            records.append(ImageRecord(img, mask, scenario))

    if split == "test":
        test_root = cfg.resolve("data.test_dir")
        found_any = False
        for scenario, aliases in (
            (OIL, ["oil", "oil_spill", "spill"]),
            (LOOKALIKE, ["lookalike", "look_alike", "look-alike", "lookalikes"]),
            (NOOIL, ["nooil", "no_oil", "no-oil", "clean"]),
        ):
            for alias in aliases:
                sub = test_root / alias
                if sub.exists():
                    collect(sub, scenario, None)
                    found_any = True
                    break
        if not found_any:
            collect(test_root, OIL, None)
        return records

    limits = limits or {}
    collect(cfg.resolve("data.oil_dir"), OIL, limits.get("oil"))
    collect(cfg.resolve("data.lookalike_dir"), LOOKALIKE, limits.get("lookalike"))
    collect(cfg.resolve("data.nooil_dir"), NOOIL, limits.get("nooil"))
    return records


def split_records(
    records: list[ImageRecord], val_fraction: float, seed: int
) -> tuple[list[ImageRecord], list[ImageRecord]]:
    """Stratified IMAGE-level split -- the leakage barrier."""
    rng = random.Random(seed)
    train: list[ImageRecord] = []
    val: list[ImageRecord] = []
    by_scenario: dict[str, list[ImageRecord]] = {}
    for rec in records:
        by_scenario.setdefault(rec.scenario, []).append(rec)

    for scenario in sorted(by_scenario):
        group = sorted(by_scenario[scenario], key=lambda r: str(r.image_path))
        rng.shuffle(group)
        n_val = int(round(len(group) * val_fraction))
        if len(group) > 1:
            n_val = max(1, min(n_val, len(group) - 1))
        val.extend(group[:n_val])
        train.extend(group[n_val:])
    return train, val


def build_patch_index(
    records: list[ImageRecord],
    cfg,
    training: bool,
    seed: int = 1337,
) -> list[PatchRef]:
    """Expand images into patch references without reading pixel data."""
    patch_cfg = cfg.get_path("patch", {})
    if not patch_cfg.get("enabled", True):
        return [PatchRef(r, 0, 0, -1, -1) for r in records]

    size = int(patch_cfg.get("size", 512))
    stride = int(patch_cfg.get("stride", size)) if training else int(
        patch_cfg.get("test_stride", size)
    )
    keep_neg = float(patch_cfg.get("negative_patch_keep", 1.0))
    rng = random.Random(seed)

    index: list[PatchRef] = []
    for rec in records:
        try:
            _, geo = read_sar_image(rec.image_path)
            h = int(geo.get("height") or 0)
            w = int(geo.get("width") or 0)
        except Exception as exc:
            print(f"[dataset] skipping unreadable {rec.image_path.name}: {exc}")
            continue
        if h <= 0 or w <= 0:
            continue

        for (r, c, ph, pw) in iter_patch_windows(h, w, size, stride):
            # Sub-sample negative scenes so the loader is not dominated by
            # empty water, while still keeping enough for the model to
            # learn the look-alike distinction.
            if training and not rec.has_oil and keep_neg < 1.0:
                if rng.random() > keep_neg:
                    continue
            index.append(PatchRef(rec, r, c, ph, pw))
    return index


class SARPatchDataset(Dataset):
    def __init__(
        self,
        patches: list[PatchRef],
        cfg,
        augment: bool = False,
        cache_size: int = 4,
    ):
        self.patches = patches
        self.cfg = cfg
        self.augment = augment
        self.pre_cfg = cfg.get_path("preprocessing", {})
        self.patch_cfg = cfg.get_path("patch", {})
        self.size = int(self.patch_cfg.get("size", 512))
        self.cache = _ImageCache(cache_size)

    def __len__(self) -> int:
        return len(self.patches)

    def _load_scene(self, rec: ImageRecord) -> tuple[np.ndarray, np.ndarray]:
        key = str(rec.image_path)
        hit = self.cache.get(key)
        if hit is not None:
            return hit

        img, _ = read_sar_image(rec.image_path)
        img = ensure_two_channels(img)
        img = normalise_channels(img, self.pre_cfg)

        if rec.mask_path is not None and Path(rec.mask_path).exists():
            try:
                mask = read_mask(rec.mask_path)
            except Exception:
                mask = np.zeros(img.shape[:2], dtype=np.uint8)
        else:
            # No mask on disk: negative scenarios are legitimately all-zero.
            mask = np.zeros(img.shape[:2], dtype=np.uint8)

        if mask.shape[:2] != img.shape[:2]:
            mask = np.zeros(img.shape[:2], dtype=np.uint8)
        # Look-alike and clean scenes carry no oil by definition.
        if not rec.has_oil:
            mask = np.zeros_like(mask)

        self.cache.put(key, (img, mask))
        return img, mask

    def _apply_augment(self, img: np.ndarray, mask: np.ndarray):
        # SAR-appropriate only: geometry plus mild speckle. No colour ops.
        if random.random() < 0.5:
            img, mask = img[:, ::-1].copy(), mask[:, ::-1].copy()
        if random.random() < 0.5:
            img, mask = img[::-1].copy(), mask[::-1].copy()
        k = random.randint(0, 3)
        if k:
            img = np.rot90(img, k, axes=(0, 1)).copy()
            mask = np.rot90(mask, k, axes=(0, 1)).copy()
        if random.random() < 0.20:
            img = np.clip(img + np.random.normal(0, 0.01, img.shape), 0, 1).astype(
                np.float32
            )
        return img, mask

    def __getitem__(self, idx: int):
        ref = self.patches[idx]
        img, mask = self._load_scene(ref.record)

        if ref.height > 0:
            img = img[ref.row : ref.row + ref.height, ref.col : ref.col + ref.width]
            mask = mask[ref.row : ref.row + ref.height, ref.col : ref.col + ref.width]
            img = pad_to(img, self.size, 0.0)
            mask = pad_to(mask, self.size, 0)

        if self.augment:
            img, mask = self._apply_augment(img, mask)

        x = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1))).float()
        y = torch.from_numpy(np.ascontiguousarray(mask)).float().unsqueeze(0)
        return {
            "image": x,
            "mask": y,
            "scenario": ref.record.scenario,
            "path": str(ref.record.image_path),
        }


def describe_records(records: list[ImageRecord]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for r in records:
        counts[r.scenario] = counts.get(r.scenario, 0) + 1
    return {"total": len(records), "per_scenario": counts}


def filter_valid_patches(
    dataset: SARPatchDataset, min_valid_fraction: float, limit: int | None = None
) -> list[int]:
    """Indices whose pixel content clears the nodata threshold."""
    keep: list[int] = []
    n = len(dataset) if limit is None else min(limit, len(dataset))
    for i in range(n):
        sample = dataset[i]
        arr = sample["image"].numpy().transpose(1, 2, 0)
        if valid_fraction(arr) >= min_valid_fraction:
            keep.append(i)
    return keep
