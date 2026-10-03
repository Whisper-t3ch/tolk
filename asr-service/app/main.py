"""ASR-сервис ТОЛК: POST /transcribe_track — контракт createHttpAsrAdapter
(src/lib/recording/asrAdapter.ts).

Запрос: multipart/form-data, поля `track` (psychologist|client) и `audio`
(файл webm/ogg/mp4/wav). Ответ JSON:
  { text, duration_seconds, segments: [{start_ms, end_ms, text}], model, processing_seconds }

Авторизация: `Authorization: Bearer ${ASR_SERVICE_TOKEN}`. Если токен не
задан — сервис не стартует (fail-closed), открытого ASR быть не должно.
"""

from __future__ import annotations

import hmac
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile

from .audio import SAMPLE_RATE, AudioDecodeError, decode_to_pcm, plan_chunks
from .engine import Engine, GigaAMEngine

VALID_TRACKS = {"psychologist", "client"}


def create_app(engine: Engine | None = None, token: str | None = None) -> FastAPI:
    token = token if token is not None else os.environ.get("ASR_SERVICE_TOKEN", "")
    if len(token) < 16:
        raise RuntimeError("ASR_SERVICE_TOKEN не задан или короче 16 символов — сервис не стартует")
    engine = engine or GigaAMEngine()
    max_upload = int(os.environ.get("ASR_MAX_UPLOAD_MB", "200")) * 1024 * 1024
    gate = threading.Semaphore(int(os.environ.get("ASR_MAX_CONCURRENCY", "1")))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if os.environ.get("ASR_PRELOAD", "1") == "1":
            threading.Thread(target=engine.load, daemon=True).start()
        yield

    app = FastAPI(title="tolk-asr", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def require_token(request: Request) -> None:
        header = request.headers.get("authorization", "")
        scheme, _, value = header.partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(value.encode(), token.encode()):
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "model": engine.model_name, "model_loaded": engine.loaded}

    @app.post("/transcribe_track", dependencies=[Depends(require_token)])
    def transcribe_track(track: str = Form(...), audio: UploadFile = File(...)):
        if track not in VALID_TRACKS:
            raise HTTPException(status_code=422, detail=f"track must be one of {sorted(VALID_TRACKS)}")
        data = audio.file.read(max_upload + 1)
        if len(data) > max_upload:
            raise HTTPException(status_code=413, detail="audio too large")
        if not data:
            raise HTTPException(status_code=400, detail="empty audio")

        started = time.monotonic()
        try:
            samples = decode_to_pcm(data)
        except AudioDecodeError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

        duration = len(samples) / SAMPLE_RATE
        segments = []
        with gate:  # CPU-bound: одна дорожка за раз по умолчанию
            for chunk in plan_chunks(samples):
                text = engine.transcribe_chunk(samples[chunk.start : chunk.end])
                if text:
                    segments.append({"start_ms": chunk.start_ms, "end_ms": chunk.end_ms, "text": text})

        return {
            "text": " ".join(s["text"] for s in segments),
            "duration_seconds": round(duration, 3),
            "segments": segments,
            "model": engine.model_name,
            "processing_seconds": round(time.monotonic() - started, 2),
            "track": track,
        }

    return app


def app_factory() -> FastAPI:
    """Для `uvicorn app.main:app_factory --factory`."""
    return create_app()
