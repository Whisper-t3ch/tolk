import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/saveSessionTranscript", () => ({ saveSessionTranscript: vi.fn() }));
import { saveSessionTranscript } from "@/lib/saveSessionTranscript";
import { AnonymizationError } from "@/lib/anonymize";
import { audioExtension, segmentsToText, processUploadedAudio, createLongFetch } from "../uploadedAudio";
import { createHttpAsrAdapter, createMockAsrAdapter } from "../asrAdapter";
import { FormData as UndiciFormData } from "undici";

const saved = vi.mocked(saveSessionTranscript);

function fakeSupabase() {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { client: client as never, updates };
}

describe("audioExtension", () => {
  it("известные расширения и mime", () => {
    expect(audioExtension("Встреча 12.10.M4A")).toBe("m4a");
    expect(audioExtension("rec.mp3")).toBe("mp3");
    expect(audioExtension("noext", "audio/ogg")).toBe("webm");
    expect(audioExtension("doc.pdf")).toBeNull();
    expect(audioExtension("virus.exe", "application/octet-stream")).toBeNull();
  });
});

describe("segmentsToText", () => {
  it("абзац после паузы больше 3 секунд", () => {
    const t = segmentsToText([
      { startMs: 0, endMs: 2000, text: "Здравствуйте." },
      { startMs: 2100, endMs: 4000, text: "Как дела?" },
      { startMs: 9000, endMs: 11000, text: "Хорошо." },
    ]);
    expect(t).toBe("Здравствуйте. Как дела?\n\nХорошо.");
  });
  it("пустые сегменты пропускаются", () => {
    expect(segmentsToText([{ startMs: 0, endMs: 1, text: "  " }])).toBe("");
  });
});

describe("processUploadedAudio", () => {
  beforeEach(() => { saved.mockReset(); });
  it("успех: текст сохраняется", async () => {
    saved.mockResolvedValue({ chunksTotal: 1, chunksEmbedded: 1 });
    const { client, updates } = fakeSupabase();
    const r = await processUploadedAudio({ supabase: client, sessionId: "s1", clientName: "Анна", audio: Buffer.alloc(9000), adapter: createMockAsrAdapter() });
    expect(r.ok).toBe(true);
    expect(saved).toHaveBeenCalledOnce();
    expect(updates.some(u => u.values.recording_status === "failed")).toBe(false);
  });
  it("пустая речь: статус failed с понятной причиной", async () => {
    const { client, updates } = fakeSupabase();
    const empty = { transcribeTrack: async () => ({ text: "", durationSeconds: 1, segments: [] }) };
    const r = await processUploadedAudio({ supabase: client, sessionId: "s1", clientName: "Анна", audio: Buffer.alloc(10), adapter: empty });
    expect(r.ok).toBe(false);
    expect(updates[0].values.recording_status).toBe("failed");
    expect(String(updates[0].values.transcript_error)).toContain("не удалось распознать речь");
    expect(saved).not.toHaveBeenCalled();
  });
  it("сбой обезличивания: сырой текст не сохраняется", async () => {
    saved.mockImplementation(async () => { throw new AnonymizationError("llm_error", "x"); });
    const { client, updates } = fakeSupabase();
    const r = await processUploadedAudio({ supabase: client, sessionId: "s1", clientName: "Анна", audio: Buffer.alloc(9000), adapter: createMockAsrAdapter() });
    expect(r.ok).toBe(false);
    expect(String(updates[0].values.transcript_error)).toContain("обезлич");
  });
  it("сбой ASR: статус failed", async () => {
    const { client, updates } = fakeSupabase();
    const broken = { transcribeTrack: async () => { throw new Error("ASR down"); } };
    const r = await processUploadedAudio({ supabase: client, sessionId: "s1", clientName: "Анна", audio: Buffer.alloc(10), adapter: broken });
    expect(r.ok).toBe(false);
    expect(updates[0].values.recording_status).toBe("failed");
  });
});

describe("длинный fetch к ASR", () => {
  it("multipart доходит до сервера, медленный ответ не обрывается", async () => {
    let gotContentType = "";
    let gotBytes = 0;
    const server = http.createServer((req, res) => {
      gotContentType = String(req.headers["content-type"] ?? "");
      req.on("data", c => { gotBytes += c.length; });
      req.on("end", () => {
        setTimeout(() => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ text: "Привет", duration_seconds: 2, segments: [{ start_ms: 0, end_ms: 2000, text: "Привет" }] }));
        }, 1500);
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const adapter = createHttpAsrAdapter(url, { fetchImpl: createLongFetch(), formDataImpl: UndiciFormData as unknown as new () => FormData, fileName: "upload.mp3" });
      const res = await adapter.transcribeTrack(Buffer.alloc(5000, 1), "psychologist");
      expect(res.segments[0].text).toBe("Привет");
      expect(gotContentType).toContain("multipart/form-data");
      expect(gotBytes).toBeGreaterThan(5000);
    } finally {
      server.close();
    }
  });
});
