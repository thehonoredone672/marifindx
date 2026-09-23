"""Lagrangian oil-drift simulation with Monte Carlo uncertainty.

Governing equation per particle:

    dX/dt = U_current(X, t) + alpha * U_wind(X, t) + sqrt(2*K) * dW

where alpha is the windage coefficient (~3% of wind speed is the usual
first-order estimate for a surface slick) and K is a horizontal eddy
diffusivity driving the stochastic spread. Integration uses RK2 (default,
cheap) or RK4.

SCOPE -- this is a decision-support prototype, NOT a validated
operational oil-weathering model. It omits evaporation, emulsification,
dispersion, Stokes drift, and any real ocean state. Origins it produces
are probability fields for investigators to narrow a search, not
determinations.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import numpy as np

from .geo_service import offset_km

KM_PER_M = 1.0 / 1000.0


@dataclass
class EnvironmentField:
    """Velocity field sampler. Synthetic mode returns a uniform field."""

    current_speed_ms: float = 0.35
    current_direction_deg: float = 145.0
    wind_speed_ms: float = 6.4
    wind_direction_deg: float = 180.0
    sampler: Callable[[float, float, float], dict] | None = None

    @staticmethod
    def _to_components(speed: float, direction_deg: float) -> tuple[float, float]:
        """Oceanographic convention: direction is where the flow is GOING."""
        rad = math.radians(direction_deg)
        return speed * math.sin(rad), speed * math.cos(rad)  # (east, north)

    def sample(self, lon: float, lat: float, t_hours: float) -> dict[str, float]:
        if self.sampler is not None:
            return self.sampler(lon, lat, t_hours)
        cu, cv = self._to_components(self.current_speed_ms, self.current_direction_deg)
        wu, wv = self._to_components(self.wind_speed_ms, self.wind_direction_deg)
        return {"cu": cu, "cv": cv, "wu": wu, "wv": wv}

    def as_dict(self) -> dict[str, float]:
        return {
            "current_speed_ms": self.current_speed_ms,
            "current_direction_deg": self.current_direction_deg,
            "wind_speed_ms": self.wind_speed_ms,
            "wind_direction_deg": self.wind_direction_deg,
        }


@dataclass
class DriftResult:
    particles: np.ndarray  # (n_particles, n_steps+1, 2) as (lon, lat)
    times: list[datetime]
    direction: str
    environment: dict[str, Any]
    config: dict[str, Any] = field(default_factory=dict)

    def positions_at(self, step: int) -> np.ndarray:
        step = max(0, min(step, self.particles.shape[1] - 1))
        return self.particles[:, step, :]

    def centroid_track(self) -> list[dict[str, float]]:
        out = []
        for s, t in enumerate(self.times):
            pos = self.particles[:, s, :]
            out.append(
                {
                    "lon": float(np.mean(pos[:, 0])),
                    "lat": float(np.mean(pos[:, 1])),
                    "time": t.isoformat(),
                    "spread_km": float(_spread_km(pos)),
                }
            )
        return out


def _spread_km(pos: np.ndarray) -> float:
    """1-sigma radial spread of a particle cloud, in km."""
    if pos.shape[0] < 2:
        return 0.0
    clon, clat = float(np.mean(pos[:, 0])), float(np.mean(pos[:, 1]))
    dx = (pos[:, 0] - clon) * 111.320 * math.cos(math.radians(clat))
    dy = (pos[:, 1] - clat) * 110.574
    return float(np.sqrt(np.mean(dx**2 + dy**2)))


def _vel_km_per_hour(env: EnvironmentField, lon: float, lat: float, t: float,
                     windage: float) -> tuple[float, float]:
    f = env.sample(lon, lat, t)
    u_ms = f["cu"] + windage * f["wu"]
    v_ms = f["cv"] + windage * f["wv"]
    # m/s -> km/h
    return u_ms * 3.6, v_ms * 3.6


def simulate(
    origin_lon: float,
    origin_lat: float,
    start_time: datetime,
    hours: float,
    cfg: dict[str, Any],
    env: EnvironmentField | None = None,
    backward: bool = False,
    seed_positions: np.ndarray | None = None,
) -> DriftResult:
    """Advect a particle cloud forward or backward in time."""
    n = int(cfg.get("particles", 500))
    dt_min = float(cfg.get("timestep_minutes", 15))
    windage = float(cfg.get("windage", 0.03))
    diffusivity = float(cfg.get("diffusion_m2_s", 8.0))
    integrator = str(cfg.get("integrator", "rk2")).lower()
    rng = np.random.default_rng(int(cfg.get("seed", 20260921)))

    env = env or EnvironmentField(**cfg.get("synthetic_field", {}))
    steps = max(1, int(round(hours * 60.0 / dt_min)))
    dt_h = dt_min / 60.0
    sign = -1.0 if backward else 1.0

    pos = (
        np.asarray(seed_positions, dtype=np.float64).copy()
        if seed_positions is not None
        else np.tile(np.array([origin_lon, origin_lat], dtype=np.float64), (n, 1))
    )
    n = pos.shape[0]

    # Random-walk step: sigma = sqrt(2*K*dt), K in m^2/s, dt in s.
    dt_s = dt_min * 60.0
    sigma_km = math.sqrt(2.0 * diffusivity * dt_s) / 1000.0

    track = np.zeros((n, steps + 1, 2), dtype=np.float64)
    track[:, 0, :] = pos
    times = [start_time]

    for s in range(steps):
        t_h = s * dt_h
        new = np.empty_like(pos)
        for i in range(n):
            lon, lat = pos[i]
            u1, v1 = _vel_km_per_hour(env, lon, lat, t_h, windage)

            if integrator == "rk4":
                lon2, lat2 = offset_km(lon, lat, sign * u1 * dt_h / 2, sign * v1 * dt_h / 2)
                u2, v2 = _vel_km_per_hour(env, lon2, lat2, t_h + dt_h / 2, windage)
                lon3, lat3 = offset_km(lon, lat, sign * u2 * dt_h / 2, sign * v2 * dt_h / 2)
                u3, v3 = _vel_km_per_hour(env, lon3, lat3, t_h + dt_h / 2, windage)
                lon4, lat4 = offset_km(lon, lat, sign * u3 * dt_h, sign * v3 * dt_h)
                u4, v4 = _vel_km_per_hour(env, lon4, lat4, t_h + dt_h, windage)
                u = (u1 + 2 * u2 + 2 * u3 + u4) / 6.0
                v = (v1 + 2 * v2 + 2 * v3 + v4) / 6.0
            else:  # RK2 midpoint
                lon_m, lat_m = offset_km(lon, lat, sign * u1 * dt_h / 2, sign * v1 * dt_h / 2)
                u, v = _vel_km_per_hour(env, lon_m, lat_m, t_h + dt_h / 2, windage)

            east = sign * u * dt_h + rng.normal(0.0, sigma_km)
            north = sign * v * dt_h + rng.normal(0.0, sigma_km)
            new[i, 0], new[i, 1] = offset_km(lon, lat, east, north)

        pos = new
        track[:, s + 1, :] = pos
        times.append(start_time + timedelta(hours=sign * (s + 1) * dt_h))

    return DriftResult(
        particles=track,
        times=times,
        direction="backward" if backward else "forward",
        environment=env.as_dict(),
        config={
            "particles": n,
            "integrator": integrator,
            "timestep_minutes": dt_min,
            "windage": windage,
            "diffusion_m2_s": diffusivity,
            "hours": hours,
        },
    )


def estimate_origin(
    spill_lon: float,
    spill_lat: float,
    detection_time: datetime,
    cfg: dict[str, Any],
    env: EnvironmentField | None = None,
    spill_polygon: list[list[float]] | None = None,
) -> dict[str, Any]:
    """Backward-track the observed slick to a probable-origin distribution.

    Particles are seeded across the observed slick (not just its centroid)
    so the resulting origin field inherits the slick's real extent.
    """
    hours = float(cfg.get("backtrack_hours", 24))
    n = int(cfg.get("particles", 500))
    rng = np.random.default_rng(int(cfg.get("seed", 20260921)) + 7)

    if spill_polygon and len(spill_polygon) >= 3:
        poly = np.asarray(spill_polygon, dtype=np.float64)
        idx = rng.integers(0, len(poly), size=n)
        jitter = rng.normal(0.0, 1e-4, size=(n, 2))
        seeds = poly[idx] + jitter
    else:
        seeds = np.tile(np.array([spill_lon, spill_lat]), (n, 1))

    result = simulate(
        spill_lon, spill_lat, detection_time, hours, cfg,
        env=env, backward=True, seed_positions=seeds,
    )

    final = result.positions_at(result.particles.shape[1] - 1)
    clon, clat = float(np.mean(final[:, 0])), float(np.mean(final[:, 1]))
    spread = _spread_km(final)

    # 68 / 95 percentile radii give an honest, non-Gaussian uncertainty.
    dx = (final[:, 0] - clon) * 111.320 * math.cos(math.radians(clat))
    dy = (final[:, 1] - clat) * 110.574
    radii = np.sqrt(dx**2 + dy**2)
    r68 = float(np.percentile(radii, 68))
    r95 = float(np.percentile(radii, 95))

    release_centre = detection_time - timedelta(hours=hours)
    window_pad = timedelta(hours=max(1.0, hours * 0.15))

    track = result.centroid_track()
    distance_km = 0.0
    if len(track) >= 2:
        from .geo_service import haversine_km

        distance_km = haversine_km(
            track[0]["lon"], track[0]["lat"], track[-1]["lon"], track[-1]["lat"]
        )

    return {
        "origin": {
            "lat": clat,
            "lon": clon,
            "uncertainty_radius_km": round(max(r68, 0.1), 3),
            "radius_68_km": round(r68, 3),
            "radius_95_km": round(r95, 3),
            "particle_spread_km": round(spread, 3),
        },
        "release_window": {
            "start": (release_centre - window_pad).isoformat(),
            "centre": release_centre.isoformat(),
            "end": (release_centre + window_pad).isoformat(),
        },
        "backtrack_hours": hours,
        "distance_km": round(distance_km, 3),
        "particles": [
            {"lon": round(float(p[0]), 6), "lat": round(float(p[1]), 6)} for p in final
        ],
        "centroid_track": track,
        "environment": result.environment,
        "config": result.config,
        "method": "backward Lagrangian particle tracking with stochastic diffusion",
        "caveat": (
            "Prototype decision-support estimate. Not a validated operational "
            "oil-weathering model; no evaporation, emulsification or Stokes "
            "drift is modelled."
        ),
    }


def forward_drift_path(
    origin_lon: float,
    origin_lat: float,
    release_time: datetime,
    hours: float,
    cfg: dict[str, Any],
    env: EnvironmentField | None = None,
) -> dict[str, Any]:
    """Forward simulation from the estimated origin, for the time-lapse."""
    result = simulate(origin_lon, origin_lat, release_time, hours, cfg, env=env)
    track = result.centroid_track()

    frames = []
    n_steps = result.particles.shape[1]
    stride = max(1, n_steps // 60)  # cap the payload at ~60 frames
    for s in range(0, n_steps, stride):
        pos = result.positions_at(s)
        frames.append(
            {
                "step": s,
                "time": result.times[s].isoformat(),
                "centroid": {
                    "lon": float(np.mean(pos[:, 0])),
                    "lat": float(np.mean(pos[:, 1])),
                },
                "spread_km": round(_spread_km(pos), 3),
                "particles": [
                    [round(float(p[0]), 5), round(float(p[1]), 5)] for p in pos
                ],
            }
        )

    env_dict = result.environment
    speed_ms = env_dict["current_speed_ms"] + float(
        cfg.get("windage", 0.03)
    ) * env_dict["wind_speed_ms"]

    return {
        "path": track,
        "frames": frames,
        "environment": env_dict,
        "drift_speed_ms": round(speed_ms, 4),
        "drift_direction_deg": env_dict["current_direction_deg"],
        "total_distance_km": round(
            track[-1]["spread_km"] if not track else _track_distance(track), 3
        ),
        "config": result.config,
    }


def _track_distance(track: list[dict[str, float]]) -> float:
    from .geo_service import haversine_km

    total = 0.0
    for a, b in zip(track, track[1:]):
        total += haversine_km(a["lon"], a["lat"], b["lon"], b["lat"])
    return total


def build_environment(cfg: dict[str, Any]) -> EnvironmentField:
    """Synthetic (deterministic) or adapter-backed environment.

    The adapter branch is where a real ocean/wind product would be wired
    in; it is intentionally optional so the prototype never requires an
    external API to run.
    """
    mode = str(cfg.get("mode", "synthetic"))
    if mode == "adapter":
        try:
            from .ocean_adapter import build_adapter_sampler

            return EnvironmentField(sampler=build_adapter_sampler(cfg))
        except Exception as exc:
            print(f"[drift] adapter unavailable ({exc}); using synthetic field")
    return EnvironmentField(**cfg.get("synthetic_field", {}))
