"""Sentinel-1 SAR preprocessing: Sigma0 dB -> normalised VV/VH tensors.

The Zenodo dataset ships 2048x2048x2 GeoTIFFs where band 1 = VV and
band 2 = VH, both Sigma0 in decibels. Masks are single-band and, per the
dataset documentation, are NOT georeferenced -- so masks are treated as
plain pixel matrices and only the image carries the CRS/transform.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

try:
    import rasterio

    HAS_RASTERIO = True
except Exception:  # pragma: no cover - exercised only without rasterio
    HAS_RASTERIO = False

import tifffile


def read_sar_image(path: str | Path) -> tuple[np.ndarray, dict[str, Any]]:
    """Read a SAR GeoTIFF.

    Returns (array[H, W, C] float32 in dB, georeference metadata).
    Falls back to tifffile when rasterio cannot open the file, in which
    case the georeference dict is empty and downstream code will report
    pixel coordinates instead of lat/lon.
    """
    path = Path(path)
    if HAS_RASTERIO:
        try:
            with rasterio.open(path) as src:
                arr = src.read().astype(np.float32)  # (C, H, W)
                arr = np.transpose(arr, (1, 2, 0))  # -> (H, W, C)
                geo = {
                    "transform": src.transform,
                    "crs": src.crs,
                    "width": src.width,
                    "height": src.height,
                    "count": src.count,
                    "georeferenced": src.crs is not None,
                }
                return arr, geo
        except Exception:
            pass

    arr = tifffile.imread(str(path)).astype(np.float32)
    if arr.ndim == 2:
        arr = arr[..., None]
    return arr, {"georeferenced": False, "height": arr.shape[0], "width": arr.shape[1]}


def read_mask(path: str | Path) -> np.ndarray:
    """Read a ground-truth mask as a binary uint8 array [H, W].

    Any non-zero value counts as oil. Multi-band masks collapse to band 0.
    """
    path = Path(path)
    arr = tifffile.imread(str(path))
    if arr.ndim == 3:
        arr = arr[..., 0]
    return (arr > 0).astype(np.uint8)


def normalise_channels(arr: np.ndarray, cfg: dict[str, Any]) -> np.ndarray:
    """Clip Sigma0 dB per channel and scale to [0, 1].

    Each channel gets its own clip range because VV and VH occupy
    different backscatter regimes -- normalising them jointly would
    squash the VH dynamic range that distinguishes oil from look-alikes.
    """
    channels = cfg.get("channels", ["VV", "VH"])
    clips = cfg.get("db_clip", {})
    mode = cfg.get("normalisation", "minmax")

    out = np.empty_like(arr, dtype=np.float32)
    for idx in range(arr.shape[-1]):
        band = arr[..., idx].astype(np.float32)
        name = channels[idx] if idx < len(channels) else f"B{idx}"
        lo, hi = clips.get(name, [-40.0, 5.0])

        band = np.nan_to_num(band, nan=lo, posinf=hi, neginf=lo)
        band = np.clip(band, lo, hi)

        if mode == "zscore":
            std = float(band.std())
            band = (band - float(band.mean())) / (std + 1e-6)
        else:
            band = (band - lo) / (hi - lo + 1e-6)
        out[..., idx] = band
    return out


def ensure_two_channels(arr: np.ndarray) -> np.ndarray:
    """Coerce an image to exactly 2 channels (VV, VH).

    A single-band input is duplicated -- this is recorded explicitly so it
    never silently masquerades as a genuine dual-pol acquisition.
    """
    if arr.shape[-1] == 2:
        return arr
    if arr.shape[-1] == 1:
        return np.repeat(arr, 2, axis=-1)
    return arr[..., :2]


def valid_fraction(arr: np.ndarray, nodata: float = 0.0) -> float:
    """Share of pixels that are not nodata in at least one channel."""
    if arr.size == 0:
        return 0.0
    valid = np.any(np.abs(arr - nodata) > 1e-6, axis=-1)
    return float(valid.mean())


def iter_patch_windows(
    height: int, width: int, size: int, stride: int
) -> list[tuple[int, int, int, int]]:
    """Tile an image into (row, col, h, w) windows.

    The last row/column is snapped back to the image edge so border
    content is covered without emitting undersized patches.
    """
    if size <= 0:
        return [(0, 0, height, width)]
    stride = max(1, stride)
    rows = list(range(0, max(1, height - size + 1), stride))
    cols = list(range(0, max(1, width - size + 1), stride))
    if not rows or rows[-1] + size < height:
        rows.append(max(0, height - size))
    if not cols or cols[-1] + size < width:
        cols.append(max(0, width - size))

    windows = []
    for r in sorted(set(rows)):
        for c in sorted(set(cols)):
            windows.append((r, c, min(size, height - r), min(size, width - c)))
    return windows


def pad_to(arr: np.ndarray, size: int, value: float = 0.0) -> np.ndarray:
    """Bottom/right pad a patch up to `size` so batches stack cleanly."""
    h, w = arr.shape[:2]
    if h == size and w == size:
        return arr
    pad_h, pad_w = max(0, size - h), max(0, size - w)
    pad_spec = [(0, pad_h), (0, pad_w)] + [(0, 0)] * (arr.ndim - 2)
    return np.pad(arr, pad_spec, mode="constant", constant_values=value)
