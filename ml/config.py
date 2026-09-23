"""Configuration loading and device selection."""
from __future__ import annotations

import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]


class Config(dict):
    """dict with attribute access and dotted lookup."""

    def __getattr__(self, item: str) -> Any:
        try:
            value = self[item]
        except KeyError as exc:
            raise AttributeError(item) from exc
        return Config(value) if isinstance(value, dict) else value

    def get_path(self, dotted: str, default: Any = None) -> Any:
        node: Any = self
        for part in dotted.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def resolve(self, dotted: str) -> Path:
        """Resolve a config path value against the repo root."""
        raw = self.get_path(dotted)
        if raw is None:
            raise KeyError(f"missing path config: {dotted}")
        p = Path(raw)
        return p if p.is_absolute() else REPO_ROOT / p


def load_config(path: str | Path | None = None) -> Config:
    cfg_path = Path(path) if path else REPO_ROOT / "config.yaml"
    if not cfg_path.is_absolute():
        cfg_path = REPO_ROOT / cfg_path
    with open(cfg_path, "r", encoding="utf-8") as fh:
        return Config(yaml.safe_load(fh))


@dataclass
class DevicePlan:
    device: torch.device
    use_amp: bool
    batch_size: int
    num_workers: int
    pin_memory: bool

    def describe(self) -> str:
        name = "CUDA" if self.device.type == "cuda" else "CPU"
        detail = torch.cuda.get_device_name(0) if self.device.type == "cuda" else ""
        line = f"Device: {name}"
        if detail:
            line += f" ({detail})"
        return (
            f"{line}\n"
            f"  batch_size={self.batch_size} workers={self.num_workers} "
            f"amp={self.use_amp} pin_memory={self.pin_memory}"
        )


def select_device(cfg: Config, force_cpu: bool = False) -> DevicePlan:
    """Pick CUDA when genuinely available, otherwise degrade to CPU settings."""
    train = cfg.get_path("training", {})
    cuda_ok = torch.cuda.is_available() and not force_cpu
    if cuda_ok:
        return DevicePlan(
            device=torch.device("cuda"),
            use_amp=bool(train.get("amp", True)),
            batch_size=int(train.get("batch_size", 8)),
            num_workers=int(train.get("num_workers", 4)),
            pin_memory=True,
        )
    return DevicePlan(
        device=torch.device("cpu"),
        use_amp=False,  # AMP on CPU brings no benefit here
        batch_size=int(train.get("cpu_batch_size", 2)),
        num_workers=int(train.get("cpu_num_workers", 0)),
        pin_memory=False,
    )


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)


def ensure_dirs(*paths: Path) -> None:
    for p in paths:
        Path(p).mkdir(parents=True, exist_ok=True)
