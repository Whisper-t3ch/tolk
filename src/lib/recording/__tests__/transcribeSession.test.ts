import { describe, it, expect, vi } from "vitest";
import { mergeTrackResults, transcribeAssembledSession } from "../transcribeSession";
import type { AsrAdapter, AsrTrackResult } from "../asrAdapter";
import type { SessionAssemblyOk } from "../attemptAssembly";

// Анонимизация и RAG-чанкинг зовут настоящий YandexGPT по сети — в
// тестах подменяем их детерминированными заглушками, иначе vitest run
// попытался бы делать реальные HTTP-запросы.
vi.mock("@/lib/anonymize", () => ({
  anonymizeTranscripts: vi.fn(async (texts: string[]) => texts.map(t => `ANON(${t})`)),
}));
vi.mock("@/lib/transcriptChunking", () => ({
  chunkAndEmbedTranscript: vi.fn(async () => ({ chunksTotal: 2, chunksEmbedded: 2 })),
}));

import { anonymizeTranscripts } from "@/lib/anonymize";
import { chunkAndEmbedTranscript } from "@/lib/transcriptChunking";

const SESSION_ID = "33333333-3333-3333-3333-333333333333";

describe("mergeTrackResults", () => {
  it("сводит сегменты обеих дорожек по возрастанию startMs, сохраняя порядок при равенстве", () => {
    const tracks: Partial<Record<"psychologist" | "client", AsrTrackResult>> = {
      psychologist: {
        text: "",
        durationSeconds: null,
        segments: [
          { startMs: 0, endMs: 1000, text: "П1" },
          { startMs: 3000, endMs: 4000, text: "П2" },
        ],
      },
      client: {
        text: "",
        durationSeconds: null,
        segments: [{ startMs: 1000, endMs: 2500, text: "К1" }],
      },
    };

    const merged = mergeTrackResults(tracks);

    expect(merged.map(s => s.text)).toEqual(["П1", "К1", "П2"]);
    expect(merged.map(s => s.speaker)).toEqual(["psychologist", "client", "psychologist"]);
  });
});

function makeSupabaseMock(opts?: { segmentsInsertError?: string }) {
  const inserted: { transcripts: any[]; segments: any[] } = { transcripts: [], segments: [] };
  const client = {
    from(table: string) {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({
              async maybeSingle() {
                return { data: { clients: { name: "Анна" } }, error: null };
              },
            }),
          }),
        };
      }
      if (table === "session_transcripts") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              async single() {
                const id = "transcript-1";
                inserted.transcripts.push({ id, ...row });
                return { data: { id }, error: null };
              },
            }),
          }),
        };
      }
      if (table === "session_transcript_segments") {
        return {
          async insert(rows: any[]) {
            if (opts?.segmentsInsertError) return { error: { message: opts.segmentsInsertError } };
            inserted.segments.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, inserted };
}

function makeAssembly(psychologistText: string, clientText?: string): SessionAssemblyOk {
  return {
    ok: true,
    attemptsUsed: ["attempt-1"],
    tracks: {
      psychologist: { buffer: Buffer.from(psychologistText), totalChunks: 1 },
      ...(clientText ? { client: { buffer: Buffer.from(clientText), totalChunks: 1 } } : {}),
    },
  };
}

function makeAdapter(responses: Record<string, AsrTrackResult>): AsrAdapter {
  return {
    async transcribeTrack(buffer, track) {
      const result = responses[track];
      if (!result) throw new Error(`no mock response configured for ${track}`);
      return result;
    },
  };
}

describe("transcribeAssembledSession", () => {
  it("happy path: ASR → анонимизация по сегментам → сохранение транскрипта и сегментов → RAG-чанкинг", async () => {
    const { client, inserted } = makeSupabaseMock();
    const assembly = makeAssembly("audio-p", "audio-c");
    const adapter = makeAdapter({
      psychologist: { text: "", durationSeconds: 10, segments: [{ startMs: 0, endMs: 2000, text: "Как дела?" }] },
      client: { text: "", durationSeconds: 8, segments: [{ startMs: 2000, endMs: 4000, text: "Нормально" }] },
    });

    const outcome = await transcribeAssembledSession(client, { sessionId: SESSION_ID, assembly, adapter });

    expect(outcome.kind).toBe("completed");
    expect(anonymizeTranscripts).toHaveBeenCalledWith(["Как дела?", "Нормально"], "Анна");
    expect(inserted.transcripts[0].raw_text).toBe("Психолог: ANON(Как дела?)\n\nКлиент: ANON(Нормально)");
    expect(inserted.transcripts[0].source).toBe("jitsi_browser");
    expect(inserted.segments).toEqual([
      { session_id: SESSION_ID, speaker: "psychologist", ordinal: 0, start_ms: 0, end_ms: 2000, text: "ANON(Как дела?)" },
      { session_id: SESSION_ID, speaker: "client", ordinal: 1, start_ms: 2000, end_ms: 4000, text: "ANON(Нормально)" },
    ]);
    expect(chunkAndEmbedTranscript).toHaveBeenCalledWith(client, SESSION_ID, "Психолог: ANON(Как дела?)\n\nКлиент: ANON(Нормально)");
    if (outcome.kind === "completed") {
      expect(outcome.result).toMatchObject({ transcriptId: "transcript-1", segments: 2, chunksTotal: 2, chunksEmbedded: 2 });
    }
  });

  it("ошибка ASR на одной дорожке → failed, не падает молча", async () => {
    const { client } = makeSupabaseMock();
    const assembly = makeAssembly("audio-p");
    const adapter: AsrAdapter = {
      async transcribeTrack() {
        throw new Error("сервис недоступен");
      },
    };

    const outcome = await transcribeAssembledSession(client, { sessionId: SESSION_ID, assembly, adapter });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toMatch(/psychologist/);
      expect(outcome.reason).toMatch(/сервис недоступен/);
    }
  });

  it("обе дорожки вернули пустой транскрипт → failed", async () => {
    const { client } = makeSupabaseMock();
    const assembly = makeAssembly("audio-p");
    const adapter = makeAdapter({ psychologist: { text: "", durationSeconds: 0, segments: [] } });

    const outcome = await transcribeAssembledSession(client, { sessionId: SESSION_ID, assembly, adapter });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.reason).toMatch(/пустой/i);
  });

  it("сбой сохранения session_transcript_segments не проваливает всю задачу (best-effort)", async () => {
    const { client, inserted } = makeSupabaseMock({ segmentsInsertError: "boom" });
    const assembly = makeAssembly("audio-p");
    const adapter = makeAdapter({ psychologist: { text: "", durationSeconds: 1, segments: [{ startMs: 0, endMs: 1000, text: "Привет" }] } });

    const outcome = await transcribeAssembledSession(client, { sessionId: SESSION_ID, assembly, adapter });

    expect(outcome.kind).toBe("completed");
    expect(inserted.transcripts).toHaveLength(1);
  });
});
