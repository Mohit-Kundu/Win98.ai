"""Tiny synthesized sound cues (original, no samples). Returned as WAV data URLs."""
import base64
import io
import wave

import numpy as np

SR = 16000


def _env(n, attack=0.004, decay=6.0):
    t = np.arange(n) / SR
    return np.minimum(1, t / attack) * np.exp(-decay * t)


def _tone(freq, dur, decay=6.0, shape='sin'):
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = freq(t) if callable(freq) else freq + 0 * t
    ph = 2 * np.pi * np.cumsum(f) / SR
    w = np.sin(ph) if shape == 'sin' else np.sign(np.sin(ph)) * 0.6
    return w * _env(n, decay=decay)


def _noise(dur, decay=20.0, seed=1):
    n = int(SR * dur)
    r = np.random.default_rng(seed).uniform(-1, 1, n)
    return r * _env(n, 0.001, decay)


def _cat(*parts):
    return np.concatenate(parts)


def _gap(d):
    return np.zeros(int(SR * d))


def _mix(a, b, off=0.0):
    o = int(SR * off)
    n = max(len(a), len(b) + o)
    out = np.zeros(n)
    out[: len(a)] += a
    out[o : o + len(b)] += b
    return out


def make():
    s = {}
    s['pop'] = _tone(lambda t: 900 - 5200 * t, 0.09, 30)
    s['blip'] = _cat(_tone(880, 0.05, 25), _tone(1320, 0.07, 22))
    s['boing'] = _tone(lambda t: 240 + 140 * np.sin(2 * np.pi * 14 * t) * np.exp(-6 * t) + 80 * (1 - t / 0.4), 0.4, 6)
    s['ding'] = _mix(_tone(1318, 0.55, 7), _tone(1976, 0.55, 8) * 0.5)
    s['tada'] = _cat(*[_tone(f, 0.1, 10, 'sq') * 0.6 for f in (523, 659, 784)], _mix(_tone(1046, 0.5, 5, 'sq') * 0.55, _tone(784, 0.5, 5, 'sq') * 0.4))
    s['alert'] = _cat(_tone(740, 0.1, 9, 'sq') * 0.6, _gap(0.04), _tone(740, 0.14, 9, 'sq') * 0.6)
    s['whoosh'] = _noise(0.28, 9, 4) * np.sin(np.linspace(0, np.pi, int(SR * 0.28))) * 0.7
    # floppy drive seek: stepper clicks over a low motor buzz
    n = int(SR * 0.7)
    t = np.arange(n) / SR
    buzz = np.sign(np.sin(2 * np.pi * 95 * t)) * 0.18 * np.sin(np.pi * np.clip(t / 0.7, 0, 1))
    clicks = np.zeros(n)
    for i, at in enumerate([0.02, 0.11, 0.2, 0.24, 0.33, 0.41, 0.52, 0.58]):
        c = _tone(lambda x: 1500 - 600 * x * 20, 0.025, 120) * 0.8
        o = int(SR * at)
        clicks[o : o + len(c)] += c[: n - o]
    s['seek'] = np.clip(buzz + clicks + _noise(0.7, 5, 9) * 0.05, -1, 1)
    return {k: _wav_url(v) for k, v in s.items()}


def _wav_url(x):
    x = np.clip(x * 0.45, -1, 1)
    pcm = (x * 32767).astype('<i2')
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return 'data:audio/wav;base64,' + base64.b64encode(buf.getvalue()).decode()
