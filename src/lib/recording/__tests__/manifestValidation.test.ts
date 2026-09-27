// ============================================================
// Тест на planAttemptClose() (manifestValidation.ts) — минимальная
// правка бага recording_attempts.ended_at = NULL, обнаруженного живым
// тестом 27.09.2026 (recording_attempt_id
// 9c319a3e-9746-42c8-8803-196f539ec7ff, см.
// claude/jitsi-pilot-test-report-27-09.md в проекте).
//
// Тестируется только чистая функция — "что писать" — без реального
// SupabaseClient. Само WHERE status='active' (защита от перезаписи
// уже закрытой 'superseded' попытки) — это условие самого SQL-запроса
// в route.ts, а не этой функции; оно отдельно проверено вручную прямым
// запросом к тестовой БД (см. отчёт в проекте) на обеих реальных
// строках recording_attempts из живого теста: строка с status='active'
// действительно попадает под условие, строка с status='superseded' —
// нет. Первый прогон этого файла (до правки в route.ts/
// manifestValidation.ts) не существовал — framework в проекте
// отсутствовал, добавлен этой же правкой (см. package.json).
// ============================================================
import { describe, expect, it } from "vitest";
import { planAttemptClose } from "../manifestValidation";

describe("planAttemptClose", () => {
  it("закрывает попытку, когда attemptId есть (нормальное завершение звонка)", () => {
    const nowIso = "2026-09-27T08:01:16.900Z";
    const action = planAttemptClose({ attemptId: "9c319a3e-9746-42c8-8803-196f539ec7ff", nowIso });

    expect(action).toEqual({
      kind: "close",
      attemptId: "9c319a3e-9746-42c8-8803-196f539ec7ff",
      status: "completed",
      endedAt: nowIso,
    });
  });

  it("ничего не делает, если attemptId отсутствует (ни один фрагмент не выгружался)", () => {
    const action = planAttemptClose({ attemptId: null, nowIso: "2026-09-27T08:01:16.900Z" });
    expect(action.kind).toBe("skip");
  });

  it("ничего не делает и при attemptId === undefined (тело manifest без этого поля)", () => {
    const action = planAttemptClose({ attemptId: undefined, nowIso: "2026-09-27T08:01:16.900Z" });
    expect(action.kind).toBe("skip");
  });

  it("не путает completed с прежним 'active'/'superseded' — это третье, терминальное значение", () => {
    const action = planAttemptClose({ attemptId: "any-id", nowIso: "2026-09-27T08:01:16.900Z" });
    if (action.kind !== "close") throw new Error("expected close");
    expect(action.status).toBe("completed");
    expect(action.status).not.toBe("active");
    expect(action.status).not.toBe("superseded");
  });
});
