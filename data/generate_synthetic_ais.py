"""Write the deterministic demonstration AIS fleet to CSV.

    python data/generate_synthetic_ais.py --lat 19.05 --lon 71.75

Output columns match the MarineCadastre AIS export schema
(https://marinecadastre.gov/accessais/) so the file round-trips through
`services.ais_service.load_ais_csv` exactly like a real download would.

The scenario is FIXED in `ais_service.generate_synthetic_ais` and is not
tuned against any ranking output. The data is synthetic: it must always
be presented as "Synthetic AIS Demonstration Data" and never attributed
to a real vessel or operator.
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from ml.config import load_config  # noqa: E402
from services.ais_service import generate_synthetic_ais  # noqa: E402

HEADER = [
    "MMSI", "BaseDateTime", "LAT", "LON", "SOG", "COG",
    "Heading", "VesselName", "VesselType", "Status",
]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--lat", type=float, default=19.05, help="origin latitude")
    ap.add_argument("--lon", type=float, default=71.75, help="origin longitude")
    ap.add_argument("--release-time", default=None, help="ISO release timestamp")
    ap.add_argument("--out", default="data/synthetic/synthetic_ais.csv")
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()

    cfg = load_config(args.config)
    release = (
        datetime.fromisoformat(args.release_time)
        if args.release_time
        else datetime.now(timezone.utc)
    )
    if release.tzinfo is None:
        release = release.replace(tzinfo=timezone.utc)

    tracks = generate_synthetic_ais(
        args.lon, args.lat, release, dict(cfg.get_path("ais", {}))
    )

    out = Path(args.out)
    if not out.is_absolute():
        out = REPO_ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)

    rows = 0
    with open(out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)
        for t in tracks:
            for p in t.points:
                writer.writerow([
                    t.mmsi,
                    p["timestamp"].strftime("%Y-%m-%dT%H:%M:%S"),
                    f"{p['latitude']:.6f}",
                    f"{p['longitude']:.6f}",
                    f"{p['sog']:.2f}",
                    f"{p['cog']:.1f}",
                    f"{p['heading']:.1f}",
                    t.name,
                    t.vessel_type,
                    "under way using engine",
                ])
                rows += 1

    print(f"\nWrote {rows} AIS reports for {len(tracks)} vessels")
    print(f"  -> {out}")
    print("\nLabel: SYNTHETIC AIS DEMONSTRATION DATA (not real vessel movements)")
    print("\nUse it in an investigation with:")
    print(f'  ais.file: "{out.relative_to(REPO_ROOT).as_posix()}" in config.yaml')
    print("  or POST /api/investigation/create with "
          f'{{"ais_file": "{out.relative_to(REPO_ROOT).as_posix()}"}}')


if __name__ == "__main__":
    main()
