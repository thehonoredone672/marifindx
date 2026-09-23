"""Segmentation losses.

Default is the hybrid  L = 0.5*Dice + 0.3*BCE + 0.2*Focal  because the
three terms fail in different places:

* Dice is computed over the whole region, so it stays informative when
  oil covers well under 1% of the pixels -- a pixel-wise loss alone would
  be minimised by predicting "no oil" everywhere.
* BCE supplies a dense, well-conditioned per-pixel gradient that keeps
  early training stable before any overlap exists for Dice to measure.
* Focal down-weights the flood of easy background pixels so the update is
  dominated by the ambiguous dark patches -- exactly the oil/look-alike
  boundary this task turns on.

All weights are configurable; Tversky is available as an experimental
alternative when recall matters more than precision.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class DiceLoss(nn.Module):
    def __init__(self, smooth: float = 1.0):
        super().__init__()
        self.smooth = smooth

    def forward(self, logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        probs = torch.sigmoid(logits)
        dims = tuple(range(1, probs.ndim))
        intersection = (probs * target).sum(dims)
        denom = probs.sum(dims) + target.sum(dims)
        dice = (2.0 * intersection + self.smooth) / (denom + self.smooth)
        return 1.0 - dice.mean()


class FocalLoss(nn.Module):
    def __init__(self, gamma: float = 2.0, alpha: float = 0.25):
        super().__init__()
        self.gamma = gamma
        self.alpha = alpha

    def forward(self, logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        bce = F.binary_cross_entropy_with_logits(logits, target, reduction="none")
        probs = torch.sigmoid(logits)
        p_t = probs * target + (1.0 - probs) * (1.0 - target)
        alpha_t = self.alpha * target + (1.0 - self.alpha) * (1.0 - target)
        return (alpha_t * (1.0 - p_t).pow(self.gamma) * bce).mean()


class TverskyLoss(nn.Module):
    """alpha penalises false positives, beta false negatives."""

    def __init__(self, alpha: float = 0.3, beta: float = 0.7, smooth: float = 1.0):
        super().__init__()
        self.alpha, self.beta, self.smooth = alpha, beta, smooth

    def forward(self, logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        probs = torch.sigmoid(logits)
        dims = tuple(range(1, probs.ndim))
        tp = (probs * target).sum(dims)
        fp = (probs * (1.0 - target)).sum(dims)
        fn = ((1.0 - probs) * target).sum(dims)
        tversky = (tp + self.smooth) / (
            tp + self.alpha * fp + self.beta * fn + self.smooth
        )
        return 1.0 - tversky.mean()


class HybridLoss(nn.Module):
    def __init__(self, cfg: dict):
        super().__init__()
        self.mode = cfg.get("mode", "hybrid")
        self.w_dice = float(cfg.get("dice_weight", 0.5))
        self.w_bce = float(cfg.get("bce_weight", 0.3))
        self.w_focal = float(cfg.get("focal_weight", 0.2))

        smooth = float(cfg.get("smooth", 1.0))
        self.dice = DiceLoss(smooth)
        self.focal = FocalLoss(
            gamma=float(cfg.get("focal_gamma", 2.0)),
            alpha=float(cfg.get("focal_alpha", 0.25)),
        )
        self.tversky = TverskyLoss(
            alpha=float(cfg.get("tversky_alpha", 0.3)),
            beta=float(cfg.get("tversky_beta", 0.7)),
            smooth=smooth,
        )
        pos_weight = float(cfg.get("bce_pos_weight", 1.0))
        self.register_buffer("pos_weight", torch.tensor([pos_weight]))

    def forward(
        self, logits: torch.Tensor, target: torch.Tensor
    ) -> tuple[torch.Tensor, dict[str, float]]:
        target = target.float()
        if self.mode == "tversky":
            loss = self.tversky(logits, target)
            return loss, {"tversky": float(loss.detach())}

        d = self.dice(logits, target)
        b = F.binary_cross_entropy_with_logits(
            logits, target, pos_weight=self.pos_weight.to(logits.device)
        )
        f = self.focal(logits, target)
        total = self.w_dice * d + self.w_bce * b + self.w_focal * f
        return total, {
            "dice": float(d.detach()),
            "bce": float(b.detach()),
            "focal": float(f.detach()),
            "total": float(total.detach()),
        }


def build_loss(cfg: dict) -> HybridLoss:
    return HybridLoss(cfg)
