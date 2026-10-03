"""Декодирование и нарезка аудио дорожки для GigaAM.

GigaAM.transcribe() работает только с отрезками до ~25 с, поэтому дорожку
режем сами: ищем самое тихое место в конце окна и режем по нему. Это
избавляет от зависимости от pyannote/HuggingFace (longform-режим GigaAM
требует HF-токен и принятия условий на huggingface.co). Каждая дорожка —
один говорящий (психолог или клиент отдельно), поэтому энергетической
нарезки по паузам достаточно.

Чистые функции без ввода-вывода (кроме decode_to_pcm) — тестируются на
синтетическом сигнале, без модели.
"""

from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16000


class AudioDecodeError(Exception):
    pass


def decode_to_pcm(data: bytes, timeout_sec: int = 300) -> np.ndarray:
    """webm/ogg/mp4/wav -> float32 моно 16 кГц через ffmpeg."""
    if not data:
        raise AudioDecodeError("пустой файл")
    with tempfile.NamedTemporaryFile(suffix=".bin") as src:
        src.write(data)
        src.flush()
        cmd = [
            "ffmpeg", "-nostdin", "-v", "error", "-i", src.name,
            "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout_sec)
        except subprocess.TimeoutExpired as e:
            raise AudioDecodeError("ffmpeg: таймаут декодирования") from e
    if proc.returncode != 0:
        raise AudioDecodeError(f"ffmpeg: {proc.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


@dataclass(frozen=True)
class Chunk:
    start: int  # индекс сэмпла, включительно
    end: int  # индекс сэмпла, исключительно

    @property
    def start_ms(self) -> int:
        return int(round(self.start * 1000 / SAMPLE_RATE))

    @property
    def end_ms(self) -> int:
        return int(round(self.end * 1000 / SAMPLE_RATE))


def _frame_rms(samples: np.ndarray, frame: int) -> np.ndarray:
    n = len(samples) // frame
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    trimmed = samples[: n * frame].reshape(n, frame)
    return np.sqrt(np.mean(trimmed.astype(np.float32) ** 2, axis=1))


def speech_threshold(rms: np.ndarray) -> float:
    """Порог «тут есть речь»: доля от громкой части дорожки, но не ниже абсолютного пола."""
    if rms.size == 0:
        return 0.004
    return float(max(0.004, 0.08 * np.percentile(rms, 95)))


def plan_chunks(
    samples: np.ndarray,
    sample_rate: int = SAMPLE_RATE,
    max_sec: float = 24.0,
    min_sec: float = 3.0,
    frame_ms: int = 30,
) -> list[Chunk]:
    """Нарезает дорожку на отрезки <= max_sec по самым тихим местам.

    Полностью тихие отрезки (нет речи) пропускаются — иначе модель
    «галлюцинирует» текст на тишине. Объединение отрезков покрывает всю
    речь дорожки без пересечений.
    """
    total = len(samples)
    if total == 0:
        return []
    frame = max(1, int(sample_rate * frame_ms / 1000))
    rms = _frame_rms(samples, frame)
    thr = speech_threshold(rms)
    max_len = int(max_sec * sample_rate)
    min_len = int(min_sec * sample_rate)

    bounds: list[tuple[int, int]] = []
    start = 0
    while total - start > max_len:
        lo = start + min_len
        hi = start + max_len
        f_lo, f_hi = lo // frame, hi // frame
        window = rms[f_lo:f_hi]
        if window.size == 0:
            cut = hi
        else:
            # самое тихое место; при равенстве — ближайшее к концу окна (длиннее отрезок)
            idx = int(len(window) - 1 - np.argmin(window[::-1]))
            cut = (f_lo + idx) * frame + frame // 2
            cut = min(max(cut, lo), hi)
        bounds.append((start, cut))
        start = cut
    bounds.append((start, total))

    chunks: list[Chunk] = []
    for s, e in bounds:
        seg = rms[s // frame : max(e // frame, s // frame + 1)]
        if seg.size and float(np.mean(seg > thr)) >= 0.02:
            chunks.append(Chunk(s, e))
    return chunks
