#!/usr/bin/env python3
"""Beat-grid analysis for Bridge88.

Reads one audio file and prints exactly one JSON object on stdout. Diagnostics
go to stderr, so the caller can parse the whole stream.

Determinism is the contract, not a nicety: SR, HOP and the regularisation rule
below decide every grid this ever produces. Changing any of them changes every
grid, so bump GRID_VERSION when you do.

librosa is used rather than madmom, essentia or aubio for a licensing reason
before an accuracy one: madmom's pretrained models are CC BY-NC-SA
(non-commercial), essentia is AGPL, and aubio is GPL-3.0. librosa is ISC.
"""
import argparse
import json
import os
import sys

# Must precede the numpy import. Multi-threaded BLAS reductions are not
# bit-reproducible, and that alone is enough to move a beat by one frame.
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
           "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ[_v] = "1"
os.environ.setdefault("PYTHONHASHSEED", "0")

import numpy as np            # noqa: E402
import soundfile as sf        # noqa: E402
import librosa                # noqa: E402

GRID_VERSION = 1
SR = 22050
HOP = 512
BEATS_PER_BAR = 4
# Max deviation, in beats, between the detected grid and a straight-line fit for
# the track to count as machine-quantised. Nearly everything in this genre is.
QUANTISED_TOLERANCE = 0.12


def load(path):
    # librosa falls back to `audioread` when libsndfile cannot read the file,
    # and audioread shells out to ffmpeg — which would make the grid depend on
    # whichever ffmpeg is installed. Refuse rather than silently vary.
    if "MP3" not in sf.available_formats():
        print("libsndfile has no MP3 support; install soundfile>=0.12.1", file=sys.stderr)
        sys.exit(3)
    y, sr = librosa.load(path, sr=SR, mono=True)
    if y.size == 0:
        print("audio decoded to zero samples", file=sys.stderr)
        sys.exit(4)
    return y, sr


def regularise(beats):
    """Least-squares line through (beat index, time).

    Tracker output wobbles by a few milliseconds even on a click track. Snapping
    a quantised song back onto a straight line is what makes the cuts feel
    locked, and it removes the last source of frame-level nondeterminism.
    """
    if beats.size < 8:
        return beats, None, None
    idx = np.arange(beats.size, dtype=float)
    slope, intercept = np.polyfit(idx, beats, 1)
    if slope <= 0:
        return beats, None, None
    fitted = intercept + slope * idx
    deviation_in_beats = float(np.max(np.abs(fitted - beats)) / slope)
    return fitted, float(slope), deviation_in_beats


def beat_strength(y, sr, beats):
    """Per-beat onset strength, 0..1.

    Scored on the low mel bands rather than the broadband envelope: in this
    genre bar one is marked by the kick, and the broadband envelope is dominated
    by hats. Doubles as the signal the caller uses to skip a quiet intro.
    """
    mel = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=HOP, n_mels=128, fmax=8000)
    low = librosa.onset.onset_strength(
        S=librosa.power_to_db(mel[:16], ref=np.max), sr=sr, hop_length=HOP)
    frames = np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=HOP), 0, low.size - 1)
    strength = low[frames]
    peak = float(strength.max()) if strength.size else 0.0
    return (strength / peak) if peak > 0 else np.zeros_like(strength)


def downbeat_phase(strength, beats_per_bar=BEATS_PER_BAR):
    """Which of the four beat phases starts the bar.

    librosa reports no downbeats, so assume 4/4 and score each phase by summed
    kick energy. On four-on-the-floor and slowed pop this is reliable.
    """
    if strength.size < beats_per_bar * 2:
        return 0, 0.0
    scores = [float(strength[p::beats_per_bar].mean()) for p in range(beats_per_bar)]
    best, second = sorted(scores, reverse=True)[:2]
    phase = int(np.argmax(scores))
    confidence = 0.0 if best <= 0 else max(0.0, min(1.0, (best - second) / best))
    return phase, float(confidence)


def analyse(path, hint_bpm=None, max_beats=4096):
    y, sr = load(path)
    duration = float(librosa.get_duration(y=y, sr=sr))

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP, aggregate=np.median)
    kwargs = dict(onset_envelope=onset_env, sr=sr, hop_length=HOP, trim=False, units="time")
    if hint_bpm:
        # Pinning start_bpm is the cheapest fix for half/double-tempo errors.
        kwargs["start_bpm"] = float(hint_bpm)
    tempo, beats = librosa.beat.beat_track(**kwargs)

    tempo = float(np.atleast_1d(tempo)[0])
    beats = np.asarray(beats, dtype=float)
    if beats.size < 4:
        print("fewer than four beats detected", file=sys.stderr)
        sys.exit(5)

    fitted, ibi, deviation = regularise(beats)
    quantised = deviation is not None and deviation < QUANTISED_TOLERANCE
    if quantised:
        beats = fitted
        tempo = 60.0 / ibi
        # Extend a quantised grid across the whole file: librosa stops tracking
        # through a breakdown, but the grid should not have a hole in it.
        first = beats[0] - ibi * np.floor(beats[0] / ibi)
        beats = np.arange(first, duration, ibi)

    beats = beats[(beats >= 0.0) & (beats < duration)][:max_beats]
    strength = beat_strength(y, sr, beats)
    phase, phase_confidence = downbeat_phase(strength)
    downbeats = beats[phase::BEATS_PER_BAR]

    def r(values, digits=6):
        return [round(float(v), digits) for v in values]

    return {
        "gridVersion": GRID_VERSION,
        "analyzer": "librosa@%s" % librosa.__version__,
        "durationSeconds": round(duration, 6),
        "bpm": round(tempo, 4),
        "beatsPerBar": BEATS_PER_BAR,
        "quantised": bool(quantised),
        "tempoDeviationBeats": None if deviation is None else round(deviation, 5),
        "beats": r(beats),
        "downbeats": r(downbeats),
        "beatStrength": r(strength, 3),
        "downbeatConfidence": round(phase_confidence, 4),
    }


def main():
    parser = argparse.ArgumentParser(description="Emit a beat grid as JSON.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--hint-bpm", type=float, default=None)
    parser.add_argument("--max-beats", type=int, default=4096)
    args = parser.parse_args()
    # sort_keys + fixed separators + fixed rounding make stdout byte-stable, so
    # the JSON itself can be hashed in a regression test.
    json.dump(analyse(args.input, args.hint_bpm, args.max_beats),
              sys.stdout, separators=(",", ":"), sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
