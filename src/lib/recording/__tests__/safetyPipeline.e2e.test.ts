import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeSupabase } from "@/lib/soap/__tests__/fakeSupabase";

// Короткий E2E на тестовых данных: ASR (mock) → РЕАЛЬНАЯ анонимизация с маскировкой мата
// (только сетевой вызов YandexGPT подменён) → сохранение транскрипта → порог качества.
// Проверяет сквозное свойство: мат и неанонимизированный текст не доходят ни до YandexGPT, ни до БД.
vi.mock("@/lib/yandexgpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/yandexgpt")>("@/lib/yandexgpt");
  return { ...actual, yandexGptCompleteJson: vi.fn() };
});
vi.mock("@/lib/transcriptChunking", () => ({ chunkAndEmbedTranscript: vi.fn(async () => ({ chunksTotal: 1, chunksEmbedded: 1 })) }));

import { yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";
import { transcribeAssembledSession } from "../transcribeSession";
import { processNextRecordingJob, type JobOutcome } from "../jobQueue";
import { assessTranscriptQuality } from "@/lib/soap/transcriptQuality";
import { PROFANITY_MARKER } from "@/lib/profanity";
import type { AsrAdapter } from "../asrAdapter";
import type { SessionAssemblyOk } from "../attemptAssembly";

const SESSION_ID = "44444444-4444-4444-4444-444444444444";
const llm = vi.mocked(yandexGptCompleteJson);

const adapter: AsrAdapter = {
  async transcribeTrack(_buffer, track) {
    return track === "psychologist"
      ? { text: "", durationSeconds: 20, segments: [{ startMs: 0, endMs: 3000, text: "Здравствуйте, Анна. Что случилось?" }] }
      : {
          text: "",
          durationSeconds: 20,
          segments: [{ startMs: 3000, endMs: 9000, text: "Муж Игорь опять орал, это полная хуйня, я так заебалась" }],
        };
  },
};
const assembly: SessionAssemblyOk = {
  ok: true,
  attemptsUsed: ["a1"],
  tracks: { psychologist: { buffer: Buffer.from("p"), totalChunks: 1 }, client: { buffer: Buffer.from("c"), totalChunks: 1 } },
};

function db() {
  return makeFakeSupabase({
    sessions: [{ id: SESSION_ID, clients: { name: "Анна" } }],
    session_transcripts: [],
    session_transcript_segments: [],
  });
}

// mockClear + дефолтная реализация вместо mockReset: после mockReset vitest 2.x показывает отклонённый промис мока как падение теста.
beforeEach(() => {
  llm.mockClear();
  llm.mockImplementation(async () => ({ replacements: [] }));
});

describe("E2E безопасности: ASR → анонимизация → транскрипт", () => {
  it("мат маскируется ДО YandexGPT, ПДн заменяются, в БД попадает только обезличенный текст с маркером", async () => {
    llm.mockImplementation(async () => ({ replacements: [{ original: "Муж Игорь", replacement: "Муж" }] }));
    const { client, db: data } = db();

    const outcome = await transcribeAssembledSession(client as never, { sessionId: SESSION_ID, assembly, adapter });

    expect(outcome.kind).toBe("completed");
    // Ни один запрос к LLM не содержит мата
    for (const call of llm.mock.calls) {
      const user = call[0].find(m => m.role === "user")!.text;
      expect(user).not.toMatch(/хуйн|заебал/i);
    }
    const saved = data.inserted.session_transcripts[0].raw_text as string;
    expect(saved).toContain(PROFANITY_MARKER);
    expect(saved).not.toMatch(/хуйн|заебал|Игорь/i);
    expect(saved).toContain("Психолог: Здравствуйте, Анна. Что случилось?");
    // Короткий диалог не проходит порог качества → SOAP не будет генерироваться
    expect(assessTranscriptQuality(saved, 20)).toMatchObject({ ok: false, reason: "too_short" });
  });

  it("модерация YandexGPT при анонимизации → manual_review_required, НИЧЕГО не сохранено, сырой текст не утёк", async () => {
    llm.mockImplementation(async () => {
      throw new YandexGptError("YandexGPT вернул ошибку 400", 400, { error: { message: "Я не могу обсуждать эту тему" } });
    });
    const { client, db: data } = db();

    const outcome = await transcribeAssembledSession(client as never, { sessionId: SESSION_ID, assembly, adapter });

    expect(outcome.kind).toBe("manual_review_required");
    expect(data.inserted.session_transcripts).toBeUndefined();
    expect(data.inserted.session_transcript_segments).toBeUndefined();
    if (outcome.kind === "manual_review_required") {
      expect(outcome.reason).toMatch(/moderation_rejected/);
      expect(outcome.reason).not.toMatch(/Игорь|хуйн/);
    }
  });

  it("весь путь воркера: сбой анонимизации → статус задачи и сессии manual_review_required", async () => {
    llm.mockImplementation(async () => {
      throw new YandexGptError("YandexGPT вернул ошибку 503", 503);
    });
    const { client, db: data } = db();
    const sessionUpdates: Array<Record<string, unknown>> = [];
    const jobUpdates: Array<Record<string, unknown>> = [];
    const queueClient = {
      rpc: async () => ({ data: [{ id: "job-1", session_id: SESSION_ID, status: "processing" }], error: null }),
      from: (table: string) => {
        if (table === "sessions") return { update: (p: Record<string, unknown>) => ({ eq: async () => (sessionUpdates.push(p), { error: null }) }) };
        if (table === "recording_jobs") return { update: (p: Record<string, unknown>) => ({ eq: async () => (jobUpdates.push(p), { error: null }) }) };
        throw new Error(`unexpected ${table}`);
      },
    };

    const result = await processNextRecordingJob(
      queueClient as never,
      "w1",
      async (a): Promise<JobOutcome> => transcribeAssembledSession(client as never, { sessionId: SESSION_ID, assembly: a, adapter }),
      async () => assembly
    );

    expect(result?.outcome.kind).toBe("manual_review_required");
    expect(jobUpdates[0]).toMatchObject({ status: "manual_review_required" });
    expect(sessionUpdates[0]).toMatchObject({ recording_status: "manual_review_required" });
    expect(data.inserted.session_transcripts).toBeUndefined();
  });
});
