import subprocess

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.audio import SAMPLE_RATE, decode_to_pcm, plan_chunks
from app.main import create_app

TOKEN = "t" * 32


def speech_like(seconds: float, freq: float = 220.0, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


class FakeEngine:
    model_name = "fake"
    loaded = True

    def __init__(self):
        self.calls = []

    def load(self):
        pass

    def transcribe_chunk(self, samples):
        self.calls.append(len(samples))
        return f"фрагмент {len(self.calls)}"


# ---------- нарезка ----------

def test_short_speech_is_single_chunk():
    chunks = plan_chunks(speech_like(10))
    assert len(chunks) == 1
    assert chunks[0].start == 0


def test_long_track_cut_in_silence_and_bounded():
    # 3 фразы по 15 с, между ними 1 с тишины => резать надо в паузах
    audio = np.concatenate([speech_like(15), silence(1), speech_like(15), silence(1), speech_like(15)])
    chunks = plan_chunks(audio, max_sec=24.0)
    assert len(chunks) >= 2
    for c in chunks:
        assert (c.end - c.start) <= 24.0 * SAMPLE_RATE + 1
    # границы лежат в паузах (15-16 с, 31-32 с)
    cuts = [c.end / SAMPLE_RATE for c in chunks[:-1]]
    assert any(15.0 <= x <= 16.0 for x in cuts)


def test_chunks_cover_without_overlap():
    audio = np.concatenate([speech_like(20), silence(0.5), speech_like(20), silence(0.5), speech_like(20)])
    chunks = plan_chunks(audio)
    for a, b in zip(chunks, chunks[1:]):
        assert a.end <= b.start


def test_silent_track_gives_no_chunks():
    assert plan_chunks(silence(30)) == []


def test_silent_chunk_in_the_middle_is_skipped():
    audio = np.concatenate([speech_like(5), silence(40), speech_like(5)])
    chunks = plan_chunks(audio)
    covered = sum(c.end - c.start for c in chunks) / SAMPLE_RATE
    assert covered < 30  # 40 с тишины не отправляются в модель


def test_empty_audio():
    assert plan_chunks(np.zeros(0, dtype=np.float32)) == []


# ---------- HTTP-контракт ----------

@pytest.fixture
def webm_bytes(tmp_path):
    out = tmp_path / "t.webm"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=6", "-c:a", "libopus", str(out)],
        check=True,
    )
    return out.read_bytes()


@pytest.fixture
def client():
    engine = FakeEngine()
    app = create_app(engine=engine, token=TOKEN)
    c = TestClient(app)
    c.engine = engine
    return c


def test_decode_webm(webm_bytes):
    samples = decode_to_pcm(webm_bytes)
    assert 5.5 < len(samples) / SAMPLE_RATE < 6.5


def test_requires_token(client, webm_bytes):
    files = {"audio": ("a.webm", webm_bytes)}
    assert client.post("/transcribe_track", data={"track": "client"}, files=files).status_code == 401
    r = client.post("/transcribe_track", data={"track": "client"}, files=files, headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    assert client.engine.calls == []


def test_happy_path_matches_adapter_contract(client, webm_bytes):
    r = client.post(
        "/transcribe_track",
        data={"track": "psychologist"},
        files={"audio": ("psychologist.webm", webm_bytes)},
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["text"], str) and body["text"].startswith("фрагмент")
    assert 5.5 < body["duration_seconds"] < 6.5
    seg = body["segments"][0]
    assert set(seg) == {"start_ms", "end_ms", "text"}
    assert seg["start_ms"] == 0 and seg["end_ms"] > 5000


def test_bad_track_and_garbage_audio(client):
    h = {"Authorization": f"Bearer {TOKEN}"}
    assert client.post("/transcribe_track", data={"track": "x"}, files={"audio": ("a", b"1234")}, headers=h).status_code == 422
    assert client.post("/transcribe_track", data={"track": "client"}, files={"audio": ("a", b"not audio at all")}, headers=h).status_code == 422
    assert client.post("/transcribe_track", data={"track": "client"}, files={"audio": ("a", b"")}, headers=h).status_code == 400


def test_health_is_open_and_service_refuses_weak_token():
    c = TestClient(create_app(engine=FakeEngine(), token=TOKEN))
    assert c.get("/healthz").json()["status"] == "ok"
    with pytest.raises(RuntimeError):
        create_app(engine=FakeEngine(), token="")
    with pytest.raises(RuntimeError):
        create_app(engine=FakeEngine(), token="short")
