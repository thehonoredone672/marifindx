"""Generate synthetic, georeferenced Sentinel-1-like scenes.

PURPOSE AND HONEST SCOPE
------------------------
These are NOT real Sentinel-1 acquisitions and a model trained on them
tells you nothing about real oil-spill detection skill. They exist so the
full chain -- dataset -> patching -> training -> checkpoint -> inference
-> georeferenced polygon -> drift -> AIS -> ranking -- can be executed
and verified end-to-end on a laptop without the ~100 GB Zenodo download.

Every scene is written as a 2-band float32 GeoTIFF (band 1 = VV, band 2 =
VH, Sigma0 in dB) carrying a real EPSG:4326 transform, so the geospatial
conversion path is genuinely exercised rather than stubbed.

Three scenarios are produced, matching the Zenodo class structure:
  oil       -- dark elongated slick, damped speckle, mask = slick
  lookalike -- dark region from a low-wind area, softer edges, mask empty
  nooil     -- open water speckle only, mask empty
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]

# Demo scene is placed off the Maharashtra coast so the geodesy is real.
SCENE_ORIGIN_LAT = 19.05
SCENE_ORIGIN_LON = 71.75
PIXEL_DEG = 0.0009  # ~100 m at this latitude


def _speckle(rng: np.random.Generator, shape, mean_db: float, scale: float):
    """Multiplicative speckle approximated in the dB domain."""
    gamma = rng.gamma(shape=4.0, scale=0.25, size=shape)
    return mean_db + scale * np.log10(np.clip(gamma, 1e-3, None)) * 10.0 / 4.0


def _ellipse_mask(shape, cy, cx, ry, rx, angle_deg) -> np.ndarray:
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    t = np.deg2rad(angle_deg)
    ys, xs = yy - cy, xx - cx
    xr = xs * np.cos(t) + ys * np.sin(t)
    yr = -xs * np.sin(t) + ys * np.cos(t)
    return ((xr / rx) ** 2 + (yr / ry) ** 2) <= 1.0


def _smooth(arr: np.ndarray, passes: int = 2) -> np.ndarray:
    out = arr.astype(np.float32)
    for _ in range(passes):
        p = np.pad(out, 1, mode="edge")
        out = (
            p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + 4 * p[1:-1, 1:-1]
        ) / 8.0
    return out


def make_scene(scenario: str, size: int, seed: int):
    """Return (image[H,W,2] dB float32, mask[H,W] uint8)."""
    rng = np.random.default_rng(seed)
    shape = (size, size)

    vv = _speckle(rng, shape, mean_db=-12.0, scale=1.0)
    vh = _speckle(rng, shape, mean_db=-20.0, scale=1.0)
    mask = np.zeros(shape, dtype=np.uint8)

    if scenario == "oil":
        # Oil damps capillary waves -> strong backscatter drop, sharp edge,
        # and reduced speckle variance inside the slick.
        cy = rng.integers(size // 3, 2 * size // 3)
        cx = rng.integers(size // 3, 2 * size // 3)
        ry = rng.integers(size // 22, size // 12)
        rx = rng.integers(size // 7, size // 4)
        angle = rng.uniform(0, 180)
        region = _ellipse_mask(shape, cy, cx, ry, rx, angle)

        # Ragged edge so the boundary is not a perfect analytic ellipse.
        noise_edge = _smooth(rng.normal(0, 1, shape), 3) > 0.35
        region = region & ~(noise_edge & ~_ellipse_mask(shape, cy, cx, ry * 0.75, rx * 0.75, angle))

        soft = _smooth(region.astype(np.float32), 2)
        vv = vv - 11.0 * soft
        vh = vh - 8.0 * soft
        inside = soft > 0.5
        vv[inside] = -12.0 - 11.0 + rng.normal(0, 0.45, inside.sum())
        vh[inside] = -20.0 - 8.0 + rng.normal(0, 0.40, inside.sum())
        mask = (soft > 0.5).astype(np.uint8)

    elif scenario == "lookalike":
        # Low-wind cell: also dark, but shallower, smoother-edged and it
        # retains speckle texture. Mask stays empty -- this is a negative.
        cy = rng.integers(size // 3, 2 * size // 3)
        cx = rng.integers(size // 3, 2 * size // 3)
        ry = rng.integers(size // 8, size // 4)
        rx = rng.integers(size // 8, size // 4)
        region = _ellipse_mask(shape, cy, cx, ry, rx, rng.uniform(0, 180))
        soft = _smooth(region.astype(np.float32), 6)
        vv = vv - 7.0 * soft
        vh = vh - 5.0 * soft
    # "nooil": open water speckle only.

    img = np.stack([vv, vh], axis=-1).astype(np.float32)
    return img, mask


def write_geotiff(path: Path, img: np.ndarray, lat0: float, lon0: float) -> bool:
    """Write a georeferenced 2-band float32 GeoTIFF. True if CRS attached."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import rasterio
        from rasterio.transform import from_origin

        transform = from_origin(lon0, lat0, PIXEL_DEG, PIXEL_DEG)
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            height=img.shape[0],
            width=img.shape[1],
            count=img.shape[2],
            dtype="float32",
            crs="EPSG:4326",
            transform=transform,
            compress="deflate",
        ) as dst:
            for b in range(img.shape[2]):
                dst.write(img[..., b].astype(np.float32), b + 1)
        return True
    except Exception as exc:
        import tifffile

        print(f"  ! rasterio unavailable ({exc}); writing plain TIFF without CRS")
        tifffile.imwrite(str(path), img.astype(np.float32))
        return False


def write_mask(path: Path, mask: np.ndarray) -> None:
    import tifffile

    path.parent.mkdir(parents=True, exist_ok=True)
    tifffile.imwrite(str(path), mask.astype(np.uint8))


def generate(out_root: Path, counts: dict, size: int, seed: int, split: str) -> dict:
    summary: dict[str, int] = {}
    georeferenced = 0
    for scenario, n in counts.items():
        for i in range(n):
            s = seed + abs(hash(scenario)) % 9973 + i * 17
            img, mask = make_scene(scenario, size, s)

            base = out_root / scenario if split != "test" else out_root / scenario
            stem = f"{scenario}_{split}_{i:03d}"
            # Stagger scene origins so they do not all overlap in space.
            lat = SCENE_ORIGIN_LAT + (i % 5) * 0.02
            lon = SCENE_ORIGIN_LON + (i // 5) * 0.02

            ok = write_geotiff(base / "images" / f"{stem}.tif", img, lat, lon)
            georeferenced += int(ok)
            write_mask(base / "masks" / f"{stem}.tif", mask)
        summary[scenario] = n
    summary["_georeferenced_files"] = georeferenced
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--size", type=int, default=512, help="scene edge in pixels")
    ap.add_argument("--oil", type=int, default=24)
    ap.add_argument("--lookalike", type=int, default=16)
    ap.add_argument("--nooil", type=int, default=16)
    ap.add_argument("--test-per-class", type=int, default=6)
    ap.add_argument("--seed", type=int, default=20260921)
    ap.add_argument("--out", type=str, default="data/raw")
    args = ap.parse_args()

    out_root = REPO_ROOT / args.out
    print(f"Generating synthetic SAR scenes -> {out_root}")
    print(f"  size={args.size}x{args.size}  2 bands (VV, VH) float32 dB, EPSG:4326\n")

    train_counts = {"oil": args.oil, "lookalike": args.lookalike, "nooil": args.nooil}
    train_summary = generate(out_root, train_counts, args.size, args.seed, "train")
    print(f"train/val: {train_summary}")

    test_counts = {k: args.test_per_class for k in ("oil", "lookalike", "nooil")}
    test_summary = generate(
        out_root / "test", test_counts, args.size, args.seed + 500_000, "test"
    )
    print(f"test:      {test_summary}")

    # One scene reserved for the demo investigation flow.
    demo_dir = REPO_ROOT / "data" / "demo"
    img, mask = make_scene("oil", args.size, args.seed + 999)
    ok = write_geotiff(demo_dir / "demo_scene.tif", img, SCENE_ORIGIN_LAT, SCENE_ORIGIN_LON)
    write_mask(demo_dir / "demo_scene_mask.tif", mask)
    print(f"demo:      {demo_dir / 'demo_scene.tif'} (georeferenced={ok})")

    manifest = {
        "synthetic": True,
        "note": (
            "Synthetic SAR-like scenes for pipeline validation only. NOT real "
            "Sentinel-1 data. Metrics from these scenes measure code "
            "correctness, not oil-spill detection performance."
        ),
        "size": args.size,
        "bands": ["VV", "VH"],
        "units": "Sigma0 dB",
        "crs": "EPSG:4326",
        "pixel_degrees": PIXEL_DEG,
        "train": train_summary,
        "test": test_summary,
        "seed": args.seed,
    }
    (out_root).mkdir(parents=True, exist_ok=True)
    with open(out_root / "SYNTHETIC_MANIFEST.json", "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"\nManifest: {out_root / 'SYNTHETIC_MANIFEST.json'}")


if __name__ == "__main__":
    main()
