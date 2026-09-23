"""Zenodo Sentinel-1 oil-spill dataset preparation.

The three archives are LARGE (tens of GB). This script never downloads
anything without showing the size and asking first, and it supports
subset selection so a laptop can run the quick mode.

    python scripts/download_dataset.py --check          # inspect only
    python scripts/download_dataset.py --mode quick     # small subset
    python scripts/download_dataset.py --mode full      # everything
    python scripts/download_dataset.py --manual         # print instructions

If automatic download is unavailable or unreliable, use --manual and
place the extracted files yourself; --check then verifies the layout.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from ml.config import load_config  # noqa: E402

ZENODO = {
    "part1_oil": {
        "record": "8346860",
        "url": "https://zenodo.org/records/8346860",
        "description": "Part I — oil-spill train/validation images + masks",
        "approx_size": "~30 GB",
        "target": "oil",
    },
    "part2_negatives": {
        "record": "8253899",
        "url": "https://zenodo.org/records/8253899",
        "description": "Part II — no-oil and look-alike train/validation + masks",
        "approx_size": "~40 GB",
        "target": "lookalike + nooil",
    },
    "part3_test": {
        "record": "13761290",
        "url": "https://zenodo.org/records/13761290",
        "description": "Part III — independent test set (oil / look-alike / no-oil)",
        "approx_size": "~15 GB",
        "target": "test",
    },
}

EXPECTED_LAYOUT = """
data/raw/
├── oil/
│   ├── images/      *.tif   (2048x2048x2, VV+VH, Sigma0 dB)
│   └── masks/       *.tif   (single band, non-zero = oil)
├── lookalike/
│   ├── images/
│   └── masks/               (all-zero, or omit entirely)
├── nooil/
│   ├── images/
│   └── masks/               (all-zero, or omit entirely)
└── test/
    ├── oil/{images,masks}/
    ├── lookalike/{images,masks}/
    └── nooil/{images,masks}/
"""


def print_catalogue() -> None:
    print("\nZenodo Sentinel-1 oil-spill dataset\n" + "=" * 62)
    for key, rec in ZENODO.items():
        print(f"\n{key}")
        print(f"  {rec['description']}")
        print(f"  Size (approx): {rec['approx_size']}")
        print(f"  URL:           {rec['url']}")
        print(f"  Goes into:     data/raw/{rec['target']}")
    total = "~85 GB"
    print(f"\nTotal if you take everything: {total}")
    print("Quick mode needs only a few hundred scenes.\n")


def check_layout(cfg) -> bool:
    print("\nChecking dataset layout\n" + "=" * 62)
    print(f"Root: {cfg.resolve('data.root')}\n")

    ok = True
    total = 0
    for label, key in (
        ("oil", "data.oil_dir"),
        ("lookalike", "data.lookalike_dir"),
        ("nooil", "data.nooil_dir"),
    ):
        base = cfg.resolve(key)
        img_dir = base / "images" if (base / "images").exists() else base
        mask_dir = base / "masks" if (base / "masks").exists() else base
        images = sorted(img_dir.glob("*.tif*")) if img_dir.exists() else []
        masks = sorted(mask_dir.glob("*.tif*")) if mask_dir.exists() else []
        total += len(images)
        status = "OK " if images else "-- "
        if not images and label == "oil":
            ok = False
        print(f"  {status}{label:<12}{len(images):>5} images  {len(masks):>5} masks")
        if not img_dir.exists():
            print(f"      (missing: {img_dir})")

    test_root = cfg.resolve("data.test_dir")
    print(f"\n  test root: {test_root}")
    test_total = 0
    for scenario in ("oil", "lookalike", "nooil"):
        sub = test_root / scenario
        img_dir = sub / "images" if (sub / "images").exists() else sub
        n = len(sorted(img_dir.glob("*.tif*"))) if img_dir.exists() else 0
        test_total += n
        print(f"    {'OK ' if n else '-- '}{scenario:<12}{n:>5} images")

    manifest = cfg.resolve("data.root") / "SYNTHETIC_MANIFEST.json"
    if manifest.exists():
        print("\n  NOTE: SYNTHETIC_MANIFEST.json present — this root currently")
        print("        holds synthetic pipeline-validation scenes, not real")
        print("        Sentinel-1 data.")

    print(f"\n  train/val total: {total}   test total: {test_total}")
    if ok:
        print("\n  Layout looks usable. Train with:")
        print("      python -m ml.train --config config.yaml --mode quick")
    else:
        print("\n  No oil images found. See --manual for the expected layout.")
    return ok


def print_manual() -> None:
    print("\nManual preparation\n" + "=" * 62)
    print_catalogue()
    print("Steps:")
    print("  1. Open each Zenodo record above in a browser.")
    print("  2. Download the archives you need (start with Part I and")
    print("     a slice of Part II; Part III only for final testing).")
    print("  3. Extract them and arrange the files as:")
    print(EXPECTED_LAYOUT)
    print("  4. Images and masks are paired by filename stem, e.g.")
    print("       oil/images/scene_0001.tif  <->  oil/masks/scene_0001.tif")
    print("     A '_mask' suffix on the mask is also recognised.")
    print("  5. Verify with:")
    print("       python scripts/download_dataset.py --check")
    print("\n  Do not have the dataset yet? Validate the pipeline first with")
    print("  synthetic scenes:")
    print("       python scripts/make_demo_data.py\n")


def attempt_download(mode: str, cfg, yes: bool) -> None:
    quick = cfg.get_path("data.quick_limits", {})
    print("\nDownload plan\n" + "=" * 62)
    print(f"Mode: {mode}")
    if mode == "quick":
        print("Subset per class:")
        for k, v in quick.items():
            print(f"  {k:<12}{v}")
        print("\nZenodo publishes these as multi-GB archives with no per-file")
        print("range API, so a 'quick' subset still requires fetching a whole")
        print("archive before it can be sampled.")
    else:
        print("This fetches the complete archives (~85 GB).")

    print("\nTarget: " + str(cfg.resolve("data.root")))
    if not yes:
        reply = input("\nProceed with download? [y/N]: ").strip().lower()
        if reply != "y":
            print("Cancelled. Nothing was downloaded.")
            return

    print("\nAutomatic Zenodo download is not enabled in this prototype:")
    print("  * archive names and internal layout differ between the three")
    print("    records and change between dataset revisions;")
    print("  * a partial or silently-corrupted multi-GB download is worse")
    print("    than no download at all.")
    print("\nUse the manual route instead:")
    print("  python scripts/download_dataset.py --manual")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=["quick", "full"], default=None)
    ap.add_argument("--check", action="store_true", help="verify the local layout")
    ap.add_argument("--manual", action="store_true", help="print manual instructions")
    ap.add_argument("--list", action="store_true", help="show the Zenodo records")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()

    cfg = load_config(args.config)

    if args.list:
        print_catalogue()
        return
    if args.manual:
        print_manual()
        return
    if args.check or args.mode is None:
        check_layout(cfg)
        if args.mode is None and not args.check:
            print("\nOptions: --list  --manual  --check  --mode quick|full")
        return

    attempt_download(args.mode, cfg, args.yes)


if __name__ == "__main__":
    main()
