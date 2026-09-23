"""Attention U-Net for dual-polarisation SAR oil-spill segmentation.

Input is genuinely 2-channel (VV, VH). Rather than stacking a fake third
band to fit an RGB-pretrained stem, the encoder's first convolution is
rebuilt with in_channels=2. When pretrained weights are requested, the
new stem is seeded by averaging the RGB kernels across the colour axis
and rescaling, which preserves the learned edge/texture filters while
keeping the response magnitude comparable. That adaptation is recorded
in the model metadata so it is never an undocumented assumption.
"""
from __future__ import annotations

from typing import Any

import torch
import torch.nn as nn
import torch.nn.functional as F


class ConvBlock(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, dropout: float = 0.0):
        super().__init__()
        layers = [
            nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        ]
        if dropout > 0:
            layers.append(nn.Dropout2d(dropout))
        self.block = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class AttentionGate(nn.Module):
    """Additive attention gate (Oktay et al., 2018).

    Gates the skip connection by a signal derived from the coarser
    decoder feature, suppressing background responses before concat.
    """

    def __init__(self, gate_ch: int, skip_ch: int, inter_ch: int):
        super().__init__()
        self.theta = nn.Conv2d(skip_ch, inter_ch, 1, bias=False)
        self.phi = nn.Conv2d(gate_ch, inter_ch, 1, bias=True)
        self.psi = nn.Conv2d(inter_ch, 1, 1, bias=True)

    def forward(self, skip: torch.Tensor, gate: torch.Tensor) -> torch.Tensor:
        theta = self.theta(skip)
        phi = self.phi(gate)
        if phi.shape[-2:] != theta.shape[-2:]:
            phi = F.interpolate(
                phi, size=theta.shape[-2:], mode="bilinear", align_corners=False
            )
        attn = torch.sigmoid(self.psi(F.relu(theta + phi, inplace=True)))
        return skip * attn


class DecoderBlock(nn.Module):
    def __init__(self, in_ch: int, skip_ch: int, out_ch: int, dropout: float = 0.0):
        super().__init__()
        self.attn = AttentionGate(in_ch, skip_ch, max(skip_ch // 2, 8)) if skip_ch else None
        self.conv = ConvBlock(in_ch + skip_ch, out_ch, dropout)

    def forward(self, x: torch.Tensor, skip: torch.Tensor | None) -> torch.Tensor:
        x = F.interpolate(x, scale_factor=2, mode="bilinear", align_corners=False)
        if skip is not None:
            if x.shape[-2:] != skip.shape[-2:]:
                x = F.interpolate(
                    x, size=skip.shape[-2:], mode="bilinear", align_corners=False
                )
            skip = self.attn(skip, x)
            x = torch.cat([x, skip], dim=1)
        return self.conv(x)


def _adapt_first_conv(conv: nn.Conv2d, in_channels: int) -> nn.Conv2d:
    """Rebuild a conv layer for `in_channels`, seeding from RGB weights."""
    new = nn.Conv2d(
        in_channels,
        conv.out_channels,
        kernel_size=conv.kernel_size,
        stride=conv.stride,
        padding=conv.padding,
        bias=conv.bias is not None,
    )
    with torch.no_grad():
        w = conv.weight.data  # (out, 3, k, k)
        if w.shape[1] >= 1:
            mean_kernel = w.mean(dim=1, keepdim=True)  # (out, 1, k, k)
            seeded = mean_kernel.repeat(1, in_channels, 1, 1)
            # Preserve total response magnitude across the new fan-in.
            seeded *= w.shape[1] / float(in_channels)
            new.weight.data.copy_(seeded)
        if conv.bias is not None:
            new.bias.data.copy_(conv.bias.data)
    return new


class ResNet34Encoder(nn.Module):
    """torchvision ResNet-34 trunk exposing 5 feature scales."""

    out_channels = (64, 64, 128, 256, 512)

    def __init__(self, in_channels: int = 2, pretrained: bool = False):
        super().__init__()
        from torchvision.models import resnet34

        weights = None
        if pretrained:
            try:
                from torchvision.models import ResNet34_Weights

                weights = ResNet34_Weights.DEFAULT
            except Exception:
                weights = None
        net = resnet34(weights=weights)
        self.adapted_from_rgb = weights is not None and in_channels != 3
        net.conv1 = _adapt_first_conv(net.conv1, in_channels)

        self.stem = nn.Sequential(net.conv1, net.bn1, net.relu)
        self.pool = net.maxpool
        self.layer1, self.layer2 = net.layer1, net.layer2
        self.layer3, self.layer4 = net.layer3, net.layer4

    def forward(self, x: torch.Tensor) -> list[torch.Tensor]:
        f0 = self.stem(x)          # /2
        f1 = self.layer1(self.pool(f0))  # /4
        f2 = self.layer2(f1)       # /8
        f3 = self.layer3(f2)       # /16
        f4 = self.layer4(f3)       # /32
        return [f0, f1, f2, f3, f4]


class EfficientNetB0Encoder(nn.Module):
    """torchvision EfficientNet-B0 trunk sampled at 5 scales."""

    out_channels = (32, 24, 40, 112, 320)

    def __init__(self, in_channels: int = 2, pretrained: bool = False):
        super().__init__()
        from torchvision.models import efficientnet_b0

        weights = None
        if pretrained:
            try:
                from torchvision.models import EfficientNet_B0_Weights

                weights = EfficientNet_B0_Weights.DEFAULT
            except Exception:
                weights = None
        net = efficientnet_b0(weights=weights)
        self.adapted_from_rgb = weights is not None and in_channels != 3
        stem_conv = net.features[0][0]
        net.features[0][0] = _adapt_first_conv(stem_conv, in_channels)

        f = net.features
        self.s0 = f[0]              # /2   32
        self.s1 = nn.Sequential(f[1], f[2])  # /4  24
        self.s2 = f[3]              # /8   40
        self.s3 = nn.Sequential(f[4], f[5])  # /16 112
        self.s4 = nn.Sequential(f[6], f[7])  # /32 320

    def forward(self, x: torch.Tensor) -> list[torch.Tensor]:
        f0 = self.s0(x)
        f1 = self.s1(f0)
        f2 = self.s2(f1)
        f3 = self.s3(f2)
        f4 = self.s4(f3)
        return [f0, f1, f2, f3, f4]


class PlainEncoder(nn.Module):
    """Dependency-free encoder; used when torchvision is unavailable."""

    def __init__(self, in_channels: int = 2, base: int = 32, dropout: float = 0.0):
        super().__init__()
        w = [base, base * 2, base * 4, base * 8, base * 16]
        self.out_channels = tuple(w)
        self.b0 = ConvBlock(in_channels, w[0], dropout)
        self.b1 = ConvBlock(w[0], w[1], dropout)
        self.b2 = ConvBlock(w[1], w[2], dropout)
        self.b3 = ConvBlock(w[2], w[3], dropout)
        self.b4 = ConvBlock(w[3], w[4], dropout)
        self.pool = nn.MaxPool2d(2)
        self.adapted_from_rgb = False

    def forward(self, x: torch.Tensor) -> list[torch.Tensor]:
        f0 = self.b0(x)
        f1 = self.b1(self.pool(f0))
        f2 = self.b2(self.pool(f1))
        f3 = self.b3(self.pool(f2))
        f4 = self.b4(self.pool(f3))
        return [f0, f1, f2, f3, f4]


class AttentionUNet(nn.Module):
    def __init__(
        self,
        in_channels: int = 2,
        out_channels: int = 1,
        encoder: str = "resnet34",
        pretrained: bool = False,
        base_width: int = 32,
        dropout: float = 0.0,
    ):
        super().__init__()
        self.encoder_name = encoder
        self.in_channels = in_channels

        enc: nn.Module
        try:
            if encoder == "resnet34":
                enc = ResNet34Encoder(in_channels, pretrained)
            elif encoder in ("efficientnet_b0", "efficientnet-b0"):
                enc = EfficientNetB0Encoder(in_channels, pretrained)
            else:
                enc = PlainEncoder(in_channels, base_width, dropout)
        except Exception as exc:  # torchvision missing / weights unreachable
            print(f"[model] encoder '{encoder}' unavailable ({exc}); using plain encoder")
            enc = PlainEncoder(in_channels, base_width, dropout)
            self.encoder_name = "plain"

        self.encoder = enc
        ch = list(enc.out_channels)
        # The plain encoder keeps full resolution at f0; the pretrained
        # trunks halve it, so their output needs one extra upsample.
        self.encoder_is_strided = not isinstance(enc, PlainEncoder)

        d = [max(base_width, c // 2) for c in ch]
        self.dec3 = DecoderBlock(ch[4], ch[3], d[3], dropout)
        self.dec2 = DecoderBlock(d[3], ch[2], d[2], dropout)
        self.dec1 = DecoderBlock(d[2], ch[1], d[1], dropout)
        self.dec0 = DecoderBlock(d[1], ch[0], d[0], dropout)
        self.head = nn.Conv2d(d[0], out_channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        size = x.shape[-2:]
        f0, f1, f2, f3, f4 = self.encoder(x)
        y = self.dec3(f4, f3)
        y = self.dec2(y, f2)
        y = self.dec1(y, f1)
        y = self.dec0(y, f0)
        logits = self.head(y)
        if logits.shape[-2:] != size:
            logits = F.interpolate(
                logits, size=size, mode="bilinear", align_corners=False
            )
        return logits

    def describe(self) -> dict[str, Any]:
        n_params = sum(p.numel() for p in self.parameters())
        return {
            "architecture": "attention_unet",
            "encoder": self.encoder_name,
            "in_channels": self.in_channels,
            "parameters": int(n_params),
            "first_conv_adapted_from_rgb": bool(
                getattr(self.encoder, "adapted_from_rgb", False)
            ),
            "channel_duplication_used": False,
        }


def build_model(cfg: dict) -> AttentionUNet:
    return AttentionUNet(
        in_channels=int(cfg.get("in_channels", 2)),
        out_channels=int(cfg.get("out_channels", 1)),
        encoder=str(cfg.get("encoder", "resnet34")),
        pretrained=bool(cfg.get("pretrained", False)),
        base_width=int(cfg.get("base_width", 32)),
        dropout=float(cfg.get("dropout", 0.0)),
    )
