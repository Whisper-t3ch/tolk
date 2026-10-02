import { describe, it, expect, vi, afterEach } from "vitest";
import { createMockAsrAdapter, createHttpAsrAdapter } from "../asrAdapter";

describe("createMockAsrAdapter", () => {
  it("возвращает пустой результат для пустого буфера", async () => {
    const adapter = createMockAsrAdapter();
    const result = await adapter.transcribeTrack(Buffer.alloc(0), "psychologist");
    expect(result).toEqual({ text: "", durationSeconds: 0, segments: [] });
  });

  it("нарезает буфер на детерминированные синтетические сегменты с нарастающим временем", async () => {
    const adapter = createMockAsrAdapter({ windowBytes: 10, segmentDurationMs: 1000 });
    const result = await adapter.transcribeTrack(Buffer.alloc(25, "A"), "client");

    expect(result.segments).toHaveLength(3); // ceil(25/10)
    expect(result.segments[0]).toMatchObject({ startMs: 0, endMs: 1000 });
    expect(result.segments[1]).toMatchObject({ startMs: 1000, endMs: 2000 });
    expect(result.segments[2]).toMatchObject({ startMs: 2000, endMs: 3000 });
    expect(result.segments.every(s => s.text.includes("client"))).toBe(true);
    expect(result.durationSeconds).toBe(3);
  });

  it("детерминирована — одинаковый вход даёт одинаковый результат", async () => {
    const adapter = createMockAsrAdapter();
    const buffer = Buffer.from("одна и та же запись");
    const a = await adapter.transcribeTrack(buffer, "psychologist");
    const b = await adapter.transcribeTrack(buffer, "psychologist");
    expect(a).toEqual(b);
  });
});

describe("createHttpAsrAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("парсит segments из ответа ASR-сервиса", async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          text: "привет мир",
          duration_seconds: 5,
          segments: [{ start_ms: 0, end_ms: 2000, text: "привет" }, { start_ms: 2000, end_ms: 5000, text: "мир" }],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createHttpAsrAdapter("http://asr.local");
    const result = await adapter.transcribeTrack(Buffer.from("audio bytes"), "psychologist");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://asr.local/transcribe_track");
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 2000, text: "привет" },
      { startMs: 2000, endMs: 5000, text: "мир" },
    ]);
    expect(result.durationSeconds).toBe(5);
  });

  it("строит один сегмент из text, если ASR не вернул segments", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "только текст", duration_seconds: 3 }), { status: 200 })));
    const adapter = createHttpAsrAdapter("http://asr.local");
    const result = await adapter.transcribeTrack(Buffer.from("x"), "client");
    expect(result.segments).toEqual([{ startMs: 0, endMs: 3000, text: "только текст" }]);
  });

  it("бросает AsrError при не-200 ответе", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const adapter = createHttpAsrAdapter("http://asr.local");
    await expect(adapter.transcribeTrack(Buffer.from("x"), "client")).rejects.toThrow(/500/);
  });
});
