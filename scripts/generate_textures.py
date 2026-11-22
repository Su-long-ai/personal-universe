from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(r"D:\personal-universe\public\textures")
ROOT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(20261122)

def fractal_noise(width, height, octaves=(8, 16, 32, 64, 128), weights=(0.40, 0.26, 0.17, 0.11, 0.06)):
    total = np.zeros((height, width), dtype=np.float32)
    weight_sum = 0.0
    for cells, weight in zip(octaves, weights):
        gh = max(2, int(cells * height / width))
        base = rng.random((gh, cells), dtype=np.float32)
        img = Image.fromarray(np.uint8(base * 255), mode="L").resize((width, height), Image.Resampling.BICUBIC)
        layer = np.asarray(img, dtype=np.float32) / 255.0
        total += layer * weight
        weight_sum += weight
    total /= weight_sum
    total = (total - total.min()) / max(1e-6, total.max() - total.min())
    return total

# Planet albedo
w, h = 1024, 512
noise = fractal_noise(w, h)
detail = fractal_noise(w, h, octaves=(24, 48, 96, 192), weights=(0.40, 0.28, 0.20, 0.12))
y = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
x = np.linspace(0, 2*np.pi, w, dtype=np.float32)[None, :]
warp = np.sin(x * 2.4 + y * 4.3) * 0.035
terrain = np.clip(noise * 0.82 + detail * 0.18 + warp, 0, 1)
lat = np.abs(y)
land = terrain > (0.57 - (1 - lat) * 0.02)
ice = np.clip((lat - 0.74) / 0.22, 0, 1)

rgb = np.zeros((h, w, 3), dtype=np.float32)
# ocean
depth = np.clip((0.58 - terrain) * 3.0, 0, 1)
rgb[..., 0] = 8 + (1-depth) * 16
rgb[..., 1] = 34 + (1-depth) * 38
rgb[..., 2] = 65 + (1-depth) * 68
# land
alt = np.clip((terrain - 0.55) * 3.6, 0, 1)
land_rgb = np.stack([
    34 + alt * 70,
    59 + alt * 62,
    57 + alt * 45
], axis=-1)
rgb = np.where(land[..., None], land_rgb, rgb)
# polar ice
ice_rgb = np.stack([
    205 + detail * 38,
    218 + detail * 30,
    232 + detail * 20
], axis=-1)
rgb = rgb * (1 - ice[..., None]) + ice_rgb * ice[..., None]
Image.fromarray(np.uint8(np.clip(rgb, 0, 255)), mode="RGB").save(ROOT / "aurora-albedo.png", optimize=True)

# Cloud map
cloud_noise = fractal_noise(w, h, octaves=(12, 24, 48, 96), weights=(0.45, 0.28, 0.18, 0.09))
cloud_alpha = np.clip((cloud_noise - 0.52) * 2.6, 0, 1)
cloud_alpha *= np.clip(1 - (lat - 0.82) * 2.5, 0.25, 1)
cloud = np.zeros((h, w, 4), dtype=np.uint8)
cloud[..., :3] = 235
cloud[..., 3] = np.uint8(cloud_alpha * 135)
Image.fromarray(cloud, mode="RGBA").save(ROOT / "aurora-clouds.png", optimize=True)

# Milky Way-ish translucent band
w2, h2 = 1536, 512
n = fractal_noise(w2, h2, octaves=(12, 24, 48, 96, 192), weights=(0.32, 0.24, 0.19, 0.15, 0.10))
yy = np.linspace(-1, 1, h2, dtype=np.float32)[:, None]
xx = np.linspace(0, 1, w2, dtype=np.float32)[None, :]
body = np.exp(-np.power(np.abs(yy) * 2.35, 1.72))
edge_y = np.clip((1 - np.abs(yy)) / 0.34, 0, 1) ** 1.8
edge_x = np.power(np.clip(np.sin(xx * np.pi), 0, 1), 0.42)
lane_center = np.sin(xx * np.pi * 10.5) * 0.055
dark_lane = 1 - 0.64 * np.exp(-np.power((yy - lane_center) * 12.0, 2))
core = 0.55 + 0.45 * np.exp(-np.power((xx - 0.47) * 3.4, 2))
intensity = np.clip(body * edge_y * edge_x * (0.25 + n * 1.05) * dark_lane * core, 0, 1)
dust = np.zeros((h2, w2, 4), dtype=np.uint8)
dust[..., 0] = np.uint8(108 + intensity * 72)
dust[..., 1] = np.uint8(132 + intensity * 76)
dust[..., 2] = np.uint8(185 + intensity * 65)
dust[..., 3] = np.uint8(intensity * 92)
Image.fromarray(dust, mode="RGBA").save(ROOT / "milkyway-dust.png", optimize=True)

# Soft star corona
s = 256
yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
cx = cy = (s - 1) / 2
d = np.sqrt((xx-cx)**2 + (yy-cy)**2) / (s/2)
core = np.exp(-(d**2) * 22)
halo = np.exp(-d * 5.2)
alpha = np.clip(core * 0.95 + halo * 0.5, 0, 1)
glow = np.zeros((s, s, 4), dtype=np.uint8)
glow[..., 0] = 255
glow[..., 1] = 215
glow[..., 2] = 155
glow[..., 3] = np.uint8(alpha * 255)
Image.fromarray(glow, mode="RGBA").save(ROOT / "star-corona.png", optimize=True)

for p in sorted(ROOT.glob("*.png")):
    print(p.name, p.stat().st_size)
