"""Optional ONNX export.

    python -m ml.export_onnx --config config.yaml

Requires `pip install onnx onnxruntime`. Failure here never affects the
PyTorch path -- the .pt checkpoint remains the primary artefact.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from .config import load_config
from .inference import CheckpointMissing, load_model


def main() -> None:
    ap = argparse.ArgumentParser(description="Export the checkpoint to ONNX")
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    cfg = load_config(args.config)
    try:
        model, ckpt, ckpt_path = load_model(cfg, args.checkpoint, "cpu")
    except CheckpointMissing as exc:
        print(f"\n{exc}\n")
        raise SystemExit(2)

    patch = int((ckpt.get("patch_config") or {}).get("size", cfg.get_path("patch.size", 512)))
    channels = int(cfg.get_path("model.in_channels", 2))
    dummy = torch.randn(1, channels, patch, patch)

    out = Path(args.out) if args.out else (
        cfg.resolve("paths.models_dir") / "marifindx_oil_segmentation.onnx"
    )
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"Exporting {ckpt_path}")
    print(f"  input: (1, {channels}, {patch}, {patch})  opset {args.opset}")
    try:
        torch.onnx.export(
            model, dummy, str(out),
            input_names=["sar_vv_vh"], output_names=["oil_logits"],
            dynamic_axes={
                "sar_vv_vh": {0: "batch", 2: "height", 3: "width"},
                "oil_logits": {0: "batch", 2: "height", 3: "width"},
            },
            opset_version=args.opset,
            do_constant_folding=True,
        )
    except Exception as exc:
        print(f"\nExport failed: {exc}")
        print("Install the exporter deps:  pip install onnx onnxruntime")
        raise SystemExit(1)

    print(f"Wrote {out}  ({out.stat().st_size / 1e6:.1f} MB)")

    try:
        import numpy as np
        import onnxruntime as ort

        sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
        onnx_out = sess.run(None, {"sar_vv_vh": dummy.numpy()})[0]
        with torch.no_grad():
            torch_out = model(dummy).numpy()
        delta = float(np.abs(onnx_out - torch_out).max())
        print(f"Parity check: max |onnx - torch| = {delta:.2e}")
        if delta > 1e-3:
            print("  WARNING: outputs diverge more than expected.")
    except ImportError:
        print("onnxruntime not installed; skipped the parity check.")
    except Exception as exc:
        print(f"Parity check failed: {exc}")

    meta_path = cfg.resolve("paths.models_dir") / str(
        cfg.get_path("paths.metadata_name", "model_metadata.json")
    )
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as fh:
                meta = json.load(fh)
            meta["onnx_export"] = {
                "path": str(out),
                "opset": args.opset,
                "input_shape": [1, channels, patch, patch],
            }
            with open(meta_path, "w", encoding="utf-8") as fh:
                json.dump(meta, fh, indent=2)
        except Exception:
            pass


if __name__ == "__main__":
    main()
