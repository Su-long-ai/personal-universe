from pathlib import Path
import wave
import numpy as np

ROOT = Path(r"D:\personal-universe\public\audio")
ROOT.mkdir(parents=True, exist_ok=True)
wav_path = ROOT / "deep-space.wav"

sr = 44100
duration = 24.0
n = int(sr * duration)
t = np.arange(n, dtype=np.float64) / sr
rng = np.random.default_rng(20261122)

def periodic_noise(seed_offset: int, cutoff=520.0):
    local = np.random.default_rng(20261122 + seed_offset)
    freqs = np.fft.rfftfreq(n, 1 / sr)
    phases = local.uniform(0, 2*np.pi, len(freqs))
    amp = np.zeros_like(freqs)
    mask = (freqs >= 4) & (freqs <= cutoff)
    amp[mask] = 1 / np.power(freqs[mask], 0.72)
    amp *= np.exp(-np.power(freqs / cutoff, 2.2))
    spec = amp * np.exp(1j * phases)
    spec[0] = 0
    x = np.fft.irfft(spec, n=n)
    x /= max(np.max(np.abs(x)), 1e-9)
    return x

# Frequencies chosen so each component completes an integer number of cycles in 24 s.
drone_l = (
    0.38*np.sin(2*np.pi*36*t)
    + 0.20*np.sin(2*np.pi*54*t + 0.6)
    + 0.11*np.sin(2*np.pi*72*t + 1.8)
    + 0.055*np.sin(2*np.pi*108*t + 0.3)
)
drone_r = (
    0.36*np.sin(2*np.pi*36*t + 0.09)
    + 0.22*np.sin(2*np.pi*54*t + 0.8)
    + 0.10*np.sin(2*np.pi*72*t + 1.5)
    + 0.06*np.sin(2*np.pi*108*t + 0.6)
)

# Slow periodic amplitude movement; also seamless at loop boundary.
movement_l = 0.72 + 0.17*np.sin(2*np.pi*t/duration) + 0.08*np.sin(4*np.pi*t/duration + 0.7)
movement_r = 0.72 + 0.16*np.sin(2*np.pi*t/duration + 0.4) + 0.07*np.sin(4*np.pi*t/duration + 1.1)

noise_l = periodic_noise(1)
noise_r = periodic_noise(2)

left = drone_l * movement_l + 0.10*noise_l
right = drone_r * movement_r + 0.10*noise_r

# Very subtle high shimmer, still periodic.
left += 0.018*np.sin(2*np.pi*432*t + 0.3) * (0.5 + 0.5*np.sin(2*np.pi*t/duration))
right += 0.017*np.sin(2*np.pi*432*t + 1.0) * (0.5 + 0.5*np.sin(2*np.pi*t/duration + 0.25))

stereo = np.stack([left, right], axis=1)
stereo /= max(np.max(np.abs(stereo)), 1e-9)
stereo *= 0.34
pcm = np.int16(np.clip(stereo, -1, 1) * 32767)

with wave.open(str(wav_path), "wb") as wf:
    wf.setnchannels(2)
    wf.setsampwidth(2)
    wf.setframerate(sr)
    wf.writeframes(pcm.tobytes())

print(wav_path)
