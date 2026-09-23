"""Segmentation and detection metrics.

Overall pixel accuracy is deliberately NOT the headline number: with oil
typically covering well under 1% of a scene, predicting all-background
scores >99% accuracy while detecting nothing. IoU, Dice, precision and
recall are reported instead, broken out per scenario (oil / look-alike /
no-oil) so look-alike false positives stay visible.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import torch


@dataclass
class ConfusionCounts:
    tp: float = 0.0
    fp: float = 0.0
    fn: float = 0.0
    tn: float = 0.0

    def add(self, other: "ConfusionCounts") -> None:
        self.tp += other.tp
        self.fp += other.fp
        self.fn += other.fn
        self.tn += other.tn

    @property
    def iou(self) -> float:
        denom = self.tp + self.fp + self.fn
        return float(self.tp / denom) if denom > 0 else float("nan")

    @property
    def dice(self) -> float:
        denom = 2 * self.tp + self.fp + self.fn
        return float(2 * self.tp / denom) if denom > 0 else float("nan")

    @property
    def precision(self) -> float:
        denom = self.tp + self.fp
        return float(self.tp / denom) if denom > 0 else float("nan")

    @property
    def recall(self) -> float:
        denom = self.tp + self.fn
        return float(self.tp / denom) if denom > 0 else float("nan")

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        if not np.isfinite(p) or not np.isfinite(r) or (p + r) == 0:
            return float("nan")
        return float(2 * p * r / (p + r))

    @property
    def false_positive_rate(self) -> float:
        denom = self.fp + self.tn
        return float(self.fp / denom) if denom > 0 else float("nan")

    @property
    def false_negative_rate(self) -> float:
        denom = self.fn + self.tp
        return float(self.fn / denom) if denom > 0 else float("nan")

    def as_dict(self) -> dict[str, float]:
        return {
            "iou": self.iou,
            "dice": self.dice,
            "precision": self.precision,
            "recall": self.recall,
            "f1": self.f1,
            "false_positive_rate": self.false_positive_rate,
            "false_negative_rate": self.false_negative_rate,
            "tp": self.tp,
            "fp": self.fp,
            "fn": self.fn,
            "tn": self.tn,
        }


def confusion_from_tensors(
    logits: torch.Tensor, target: torch.Tensor, threshold: float = 0.5
) -> ConfusionCounts:
    with torch.no_grad():
        pred = (torch.sigmoid(logits) > threshold).float()
        tgt = (target > 0.5).float()
        return ConfusionCounts(
            tp=float((pred * tgt).sum()),
            fp=float((pred * (1 - tgt)).sum()),
            fn=float(((1 - pred) * tgt).sum()),
            tn=float(((1 - pred) * (1 - tgt)).sum()),
        )


def confusion_from_arrays(pred: np.ndarray, target: np.ndarray) -> ConfusionCounts:
    p = (pred > 0.5).astype(np.float64)
    t = (target > 0.5).astype(np.float64)
    return ConfusionCounts(
        tp=float((p * t).sum()),
        fp=float((p * (1 - t)).sum()),
        fn=float(((1 - p) * t).sum()),
        tn=float(((1 - p) * (1 - t)).sum()),
    )


@dataclass
class MetricAccumulator:
    """Aggregates pixel counts globally and per scenario class."""

    global_counts: ConfusionCounts = field(default_factory=ConfusionCounts)
    per_class: dict[str, ConfusionCounts] = field(default_factory=dict)
    per_image_iou: list[float] = field(default_factory=list)
    per_image_dice: list[float] = field(default_factory=list)
    # Scene-level detection: did we flag any oil at all?
    scene_true: list[int] = field(default_factory=list)
    scene_pred: list[int] = field(default_factory=list)
    scene_class: list[str] = field(default_factory=list)

    def update(
        self,
        counts: ConfusionCounts,
        scenario: str = "oil",
        scene_has_oil: bool | None = None,
        scene_flagged: bool | None = None,
    ) -> None:
        self.global_counts.add(counts)
        self.per_class.setdefault(scenario, ConfusionCounts()).add(counts)
        if np.isfinite(counts.iou):
            self.per_image_iou.append(counts.iou)
        if np.isfinite(counts.dice):
            self.per_image_dice.append(counts.dice)
        if scene_has_oil is not None and scene_flagged is not None:
            self.scene_true.append(int(scene_has_oil))
            self.scene_pred.append(int(scene_flagged))
            self.scene_class.append(scenario)

    def detection_summary(self) -> dict[str, float]:
        if not self.scene_true:
            return {}
        t = np.asarray(self.scene_true)
        p = np.asarray(self.scene_pred)
        tp = float(((p == 1) & (t == 1)).sum())
        fp = float(((p == 1) & (t == 0)).sum())
        fn = float(((p == 0) & (t == 1)).sum())
        tn = float(((p == 0) & (t == 0)).sum())
        out = {
            "scenes": int(len(t)),
            "sensitivity": tp / (tp + fn) if (tp + fn) else float("nan"),
            "specificity": tn / (tn + fp) if (tn + fp) else float("nan"),
            "false_positive_rate": fp / (fp + tn) if (fp + tn) else float("nan"),
            "false_negative_rate": fn / (fn + tp) if (fn + tp) else float("nan"),
            "confusion_matrix": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        }
        # Per-scenario false alarm rate matters most for look-alikes.
        for cls in sorted(set(self.scene_class)):
            idx = [i for i, c in enumerate(self.scene_class) if c == cls]
            ct, cp = t[idx], p[idx]
            if (ct == 0).all():
                out[f"{cls}_false_alarm_rate"] = float((cp == 1).mean())
            else:
                out[f"{cls}_detection_rate"] = float(
                    (cp[ct == 1] == 1).mean() if (ct == 1).any() else float("nan")
                )
        return out

    def summary(self) -> dict:
        result = {
            "global": self.global_counts.as_dict(),
            "per_class": {k: v.as_dict() for k, v in self.per_class.items()},
            "distribution": {
                "iou_mean": _safe_mean(self.per_image_iou),
                "iou_median": _safe_median(self.per_image_iou),
                "iou_values": [round(float(v), 6) for v in self.per_image_iou],
                "dice_mean": _safe_mean(self.per_image_dice),
                "dice_median": _safe_median(self.per_image_dice),
                "dice_values": [round(float(v), 6) for v in self.per_image_dice],
            },
        }
        detection = self.detection_summary()
        if detection:
            result["detection"] = detection
        return result


def _safe_mean(values: list[float]) -> float:
    return float(np.mean(values)) if values else float("nan")


def _safe_median(values: list[float]) -> float:
    return float(np.median(values)) if values else float("nan")
