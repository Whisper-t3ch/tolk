"""Обёртка над GigaAM. Модель грузится лениво (или заранее, ASR_PRELOAD=1)."""

from __future__ import annotations

import os
import tempfile
import threading
import wave
from typing import Protocol

import numpy as np

from .audio import SAMPLE_RATE


class Engine(Protocol):
    model_name: str

    @property
    def loaded(self) -> bool: ...

    def load(self) -> None: ...

    def transcribe_chunk(self, samples: np.ndarray) -> str: ...


class GigaAMEngine:
    def __init__(self, model_name: str | None = None, threads: int | None = None):
        # v3_e2e_ctc — с пунктуацией и нормализацией текста (важно для SOAP-промпта).
        self.model_name = model_name or os.environ.get("GIGAAM_MODEL", "v3_e2e_ctc")
        self._threads = threads or int(os.environ.get("TORCH_THREADS", "0")) or None
        self._model = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            import gigaam  # импорт тут: тяжёлый, и тестам он не нужен
            import torch

            if self._threads:
                torch.set_num_threads(self._threads)
            # fp16 на CPU медленнее и может падать — на CPU грузим в fp32.
            self._model = gigaam.load_model(self.model_name, fp16_encoder=False, device="cpu")

    def transcribe_chunk(self, samples: np.ndarray) -> str:
        self.load()
        pcm16 = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            with wave.open(tmp.name, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SAMPLE_RATE)
                w.writeframes(pcm16.tobytes())
            result = self._model.transcribe(tmp.name)
        # В разных версиях gigaam transcribe() возвращает str или объект с .text.
        text = getattr(result, "text", result)
        return str(text).strip()
