// ============================================================
// Регрессионный тест на продакшн-инцидент 01.10.2026.
//
// Контекст: migration_038_recording_attempt_id.sql Part 2 сняла RLS-
// политики own_session_recordings_insert/select/update на
// storage.objects (осознанно — authorize/route.ts уже выдаёт signed
// URL через admin-клиент, см. src/lib/supabase/admin.ts, и больше не
// нуждается в этих политиках). НО confirm-роут (этот файл, route.ts)
// проверял факт реальной загрузки через ОБЫЧНЫЙ cookie-клиент
// (createClient()) — с 0 policies и RLS enabled это "deny all" для
// authenticated, т.е. storage.list() ВСЕГДА возвращал пустой список,
// даже когда объект реально лежал в Storage (прямая загрузка браузера
// по signed URL от admin-клиента в authorize НЕ зависит от этих
// политик вообще).
//
// В реальном тесте в production (сессия 17d4c911-..., 01.10.2026)
// 22 из 22 вызовов confirm вернули 409 "фрагмент не найден в
// хранилище", хотя браузер успешно выгрузил все 22 чанка — 0 строк
// в session_recording_chunks. Этот тест воспроизводит ровно эту
// последовательность: attempt → authorize → (имитация прямой
// загрузки в Storage) → confirm → retry confirm → reload (повторный
// authorize того же фрагмента).
//
// На коде ДО фикса (confirm использует supabase.storage, т.е.
// cookie-клиент) шаг confirm в этом тесте падает: вместо ok:true
// приходит 409. На коде ПОСЛЕ фикса (confirm использует
// createAdminClient().storage — как уже делает authorize) тест
// проходит целиком.
// ============================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const SESSION_ID = "11111111-1111-1111-1111-111111111111";
const ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Общее состояние "БД" + "Storage" на один тест, разделяемое между
 * cookie-клиентом (таблицы — политики на них НЕ менялись, работают
 * как обычно) и admin-клиентом (Storage — единственное место, где
 * cookie- и admin-клиент расходятся: см. заголовок файла).
 */
function makeBackend() {
  const chunks = new Map<string, { checksum: string }>(); // key: attemptId|track|sequence
  const storageObjects = new Map<string, { size: number }>(); // key: storageKey
  const sessionRow = {
    id: SESSION_ID,
    recording_status: "none" as string | null,
    recording_manifest: null,
    recording_heartbeat_at: null as string | null,
  };
  const attemptRow = { id: ATTEMPT_ID, session_id: SESSION_ID, started_at: new Date(Date.now() - 2_000).toISOString() };
  return { chunks, storageObjects, sessionRow, attemptRow };
}

function chunkKey(attemptId: string, track: string, sequence: number) {
  return `${attemptId}|${track}|${sequence}`;
}

/** cookie-сессионный клиент: таблицы реальные (через shared backend), Storage ВСЕГДА пустой — так ведёт себя продакшн после Part 2 (RLS enabled, 0 policies). */
function makeCookieClient(backend: ReturnType<typeof makeBackend>) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from(table: string) {
      if (table === "app_maintenance_flags") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { enabled: false }, error: null }) }) }) };
      }
      if (table === "sessions") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...backend.sessionRow }, error: null }) }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              Object.assign(backend.sessionRow, patch);
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "recording_attempts") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...backend.attemptRow }, error: null }) }) }) }) };
      }
      if (table === "session_recording_chunks") {
        return {
          select: (_cols: string) => ({
            eq: (_c1: string, attemptId: string) => ({
              eq: (_c2: string, track: string) => ({
                eq: (_c3: string, sequence: number) => ({
                  maybeSingle: async () => {
                    const row = backend.chunks.get(chunkKey(attemptId, track, sequence));
                    return { data: row ?? null, error: null };
                  },
                }),
              }),
            }),
          }),
          upsert: async (row: { recording_attempt_id: string; track: string; sequence: number; checksum: string }) => {
            backend.chunks.set(chunkKey(row.recording_attempt_id, row.track, row.sequence), { checksum: row.checksum });
            return { data: null, error: null };
          },
        };
      }
      throw new Error(`unexpected table in cookie client: ${table}`);
    },
    storage: {
      from: () => ({
        // Ровно поведение production после Part 2: RLS enabled, 0
        // policies на storage.objects -> cookie-клиент не видит НИЧЕГО,
        // даже если объект реально есть (admin-клиент его видит, см. ниже).
        list: async () => ({ data: [], error: null }),
      }),
    },
  };
}

/** admin (service-role) клиент: обходит RLS, видит реальное состояние Storage. */
function makeAdminClient(backend: ReturnType<typeof makeBackend>) {
  return {
    storage: {
      from: () => ({
        createSignedUploadUrl: async (storageKey: string) => ({
          data: { path: storageKey, token: "test-token", signedUrl: `https://storage.test/${storageKey}?token=test-token` },
          error: null,
        }),
        list: async (folder: string, opts: { search: string }) => {
          const matches = [...backend.storageObjects.entries()]
            .filter(([key]) => key === `${folder}/${opts.search}`)
            .map(([key, meta]) => ({ name: opts.search, metadata: { size: meta.size } }));
          return { data: matches, error: null };
        },
      }),
    },
  };
}

function fakeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /recording/chunks (confirm) — регрессия продакшн-инцидента 01.10.2026", () => {
  let backend: ReturnType<typeof makeBackend>;

  beforeEach(() => {
    backend = makeBackend();
    vi.mocked(createClient).mockResolvedValue(makeCookieClient(backend) as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient(backend) as never);
  });

  it("подтверждает фрагмент, реально загруженный в Storage через signed URL — даже когда RLS-клиент психолога его не видит (attempt → authorize → upload → confirm → retry → reload)", async () => {
    const { POST: authorize } = await import("../authorize/route");
    const { POST: confirm } = await import("../route");

    const track = "psychologist";
    const sequence = 0;
    const mimeType = "audio/webm;codecs=opus";

    // 1) authorize — выдаёт токен на путь, фрагмент ещё не подтверждён.
    const authRes = await authorize(
      fakeRequest({ attemptId: ATTEMPT_ID, track, sequence, mimeType }),
      paramsFor(SESSION_ID)
    );
    const authBody = await authRes.json();
    expect(authRes.status).toBe(200);
    expect(authBody.alreadyConfirmed).toBe(false);
    expect(typeof authBody.storageKey).toBe("string");

    // 2) "браузер грузит Blob напрямую в Storage по signed URL" — этот
    // шаг не идёт через наш сервер вообще (см. комментарий в
    // authorize/route.ts), поэтому здесь просто кладём объект в тот же
    // backend.storageObjects, который видит admin-клиент — ровно то,
    // что реально происходит в проде при успешной прямой загрузке.
    backend.storageObjects.set(authBody.storageKey, { size: 11 });

    // 3) confirm — здесь и воспроизводится баг: ДО фикса confirm смотрит
    // в Storage через cookie-клиент (который видит пустой список) и
    // отвечает 409 "фрагмент не найден в хранилище", хотя объект реально
    // есть. ПОСЛЕ фикса — смотрит через admin-клиент и видит объект.
    const confirmRes = await confirm(
      fakeRequest({
        attemptId: ATTEMPT_ID,
        track,
        sequence,
        startedAtMs: 0,
        durationMs: 1000,
        checksum: "sha256:abc123",
        mimeType,
        sizeBytes: 11,
      }),
      paramsFor(SESSION_ID)
    );
    const confirmBody = await confirmRes.json();
    expect(confirmBody).toMatchObject({ ok: true, track, sequence });
    expect(confirmRes.status).toBe(200);
    expect(backend.chunks.get(chunkKey(ATTEMPT_ID, track, sequence))).toEqual({ checksum: "sha256:abc123" });

    // 4) retry — сеть моргнула до того, как браузер получил ответ,
    // тот же чанк с тем же checksum присылается повторно. Должно быть
    // безопасным no-op (upsert), НЕ ошибкой.
    const retryRes = await confirm(
      fakeRequest({
        attemptId: ATTEMPT_ID,
        track,
        sequence,
        startedAtMs: 0,
        durationMs: 1000,
        checksum: "sha256:abc123",
        mimeType,
        sizeBytes: 11,
      }),
      paramsFor(SESSION_ID)
    );
    expect(retryRes.status).toBe(200);
    expect((await retryRes.json()).ok).toBe(true);

    // 5) reload — вкладка психолога перезагрузилась, клиент заново
    // вызывает authorize для ТОГО ЖЕ (attemptId, track, sequence), который
    // уже подтверждён. Должен прийти alreadyConfirmed:true, НЕ новый
    // токен — см. комментарий в authorize/route.ts.
    const reloadAuthRes = await authorize(
      fakeRequest({ attemptId: ATTEMPT_ID, track, sequence, mimeType }),
      paramsFor(SESSION_ID)
    );
    const reloadAuthBody = await reloadAuthRes.json();
    expect(reloadAuthRes.status).toBe(200);
    expect(reloadAuthBody.alreadyConfirmed).toBe(true);
  });

  it("отклоняет confirm с ДРУГИМ checksum на уже подтверждённый (attempt_id, track, sequence) — коллизия внутри одной попытки", async () => {
    const { POST: confirm } = await import("../route");
    const track = "client";
    const sequence = 0;
    const storageKey = `${SESSION_ID}/${ATTEMPT_ID}/${track}/000000.webm`;
    backend.storageObjects.set(storageKey, { size: 5 });
    backend.chunks.set(chunkKey(ATTEMPT_ID, track, sequence), { checksum: "sha256:first" });

    const res = await confirm(
      fakeRequest({
        attemptId: ATTEMPT_ID,
        track,
        sequence,
        startedAtMs: 0,
        durationMs: 1000,
        checksum: "sha256:different",
        mimeType: "audio/webm",
        sizeBytes: 5,
      }),
      paramsFor(SESSION_ID)
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/коллизия/i);
  });
});
