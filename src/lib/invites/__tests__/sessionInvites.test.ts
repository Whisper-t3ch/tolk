import { describe, it, expect } from "vitest";
import {
  createSessionInvite,
  peekInviteToken,
  consumeInviteToken,
  revokeSessionInvites,
  type SessionInviteRow,
} from "../sessionInvites";
import { hashToken } from "../inviteTokens";

// ============================================================
// Этап 3.7 — тесты модели приглашения: истёкший/отозванный/
// использованный токен, изоляция между сессиями, подмена/порча
// токена, гонка двух параллельных consume.
// ============================================================

type Row = SessionInviteRow & { created_by: string; token_hash: string };

interface Filter {
  op: "eq" | "gt";
  key: string;
  value: unknown;
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter(row =>
    filters.every(f => {
      const actual = (row as unknown as Record<string, unknown>)[f.key];
      if (f.op === "eq") return actual === f.value;
      if (f.op === "gt") return typeof actual === "string" && typeof f.value === "string" && actual > f.value;
      return true;
    })
  );
}

function makeTable(rows: Row[], seqRef: { n: number }) {
  return {
    insert(obj: Partial<Row>) {
      return {
        select() {
          return {
            async single() {
              seqRef.n += 1;
              const row = {
                id: `invite-${seqRef.n}`,
                status: "active" as const,
                used_at: null,
                created_at: new Date().toISOString(),
                ...obj,
              } as Row;
              rows.push(row);
              return { data: row, error: null };
            },
          };
        },
      };
    },
    select() {
      return makeQuery("read", {});
    },
    update(patch: Partial<Row>) {
      return makeQuery("update", patch);
    },
  };

  function makeQuery(mode: "read" | "update", patch: Partial<Row>) {
    const filters: Filter[] = [];
    const builder = {
      eq(key: string, value: unknown) {
        filters.push({ op: "eq", key, value });
        return builder;
      },
      gt(key: string, value: unknown) {
        filters.push({ op: "gt", key, value });
        return builder;
      },
      select() {
        return builder;
      },
      async maybeSingle() {
        const matches = applyFilters(rows, filters);
        if (mode === "update") matches.forEach(r => Object.assign(r, patch));
        return { data: matches[0] ?? null, error: null };
      },
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        const matches = applyFilters(rows, filters);
        if (mode === "update") matches.forEach(r => Object.assign(r, patch));
        resolve({ data: matches, error: null });
      },
    };
    return builder;
  }
}

function makeClient(rows: Row[] = []) {
  const seqRef = { n: 0 };
  return {
    from(table: string) {
      if (table !== "session_invites") throw new Error(`unexpected table ${table}`);
      return makeTable(rows, seqRef);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const SESSION_A = "aaaaaaaa-0000-0000-0000-000000000001";
const SESSION_B = "bbbbbbbb-0000-0000-0000-000000000002";
const PSYCHOLOGIST_ID = "11111111-aaaa-bbbb-cccc-000000000001";

describe("createSessionInvite / peekInviteToken / consumeInviteToken", () => {
  it("happy path: созданный токен проходит peek, затем consume ровно один раз", async () => {
    const client = makeClient();
    const created = await createSessionInvite(client, { sessionId: SESSION_A, createdBy: PSYCHOLOGIST_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const peeked = await peekInviteToken(client, created.rawToken);
    expect(peeked).toEqual({ ok: true, invite: expect.objectContaining({ session_id: SESSION_A, status: "active" }) });

    const consumed = await consumeInviteToken(client, created.rawToken);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) expect(consumed.invite.status).toBe("used");

    const secondConsume = await consumeInviteToken(client, created.rawToken);
    expect(secondConsume).toEqual({ ok: false, reason: "used" });
  });

  it("peek НЕ потребляет токен — можно смотреть страницу согласия сколько угодно раз", async () => {
    const client = makeClient();
    const created = await createSessionInvite(client, { sessionId: SESSION_A, createdBy: PSYCHOLOGIST_ID });
    if (!created.ok) throw new Error("setup failed");

    await peekInviteToken(client, created.rawToken);
    await peekInviteToken(client, created.rawToken);
    const consumed = await consumeInviteToken(client, created.rawToken);

    expect(consumed.ok).toBe(true);
  });

  it("истёкший токен — consume отклоняется с reason 'expired'", async () => {
    const client = makeClient();
    const created = await createSessionInvite(client, { sessionId: SESSION_A, createdBy: PSYCHOLOGIST_ID, ttlMinutes: -1 });
    if (!created.ok) throw new Error("setup failed");

    const result = await consumeInviteToken(client, created.rawToken);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("отозванный токен — consume отклоняется с reason 'revoked'", async () => {
    const client = makeClient();
    const created = await createSessionInvite(client, { sessionId: SESSION_A, createdBy: PSYCHOLOGIST_ID });
    if (!created.ok) throw new Error("setup failed");

    await revokeSessionInvites(client, SESSION_A);
    const result = await consumeInviteToken(client, created.rawToken);
    expect(result).toEqual({ ok: false, reason: "revoked" });
  });

  it("неизвестный/подменённый токен — not_found, без утечки, что сессия вообще существует", async () => {
    const client = makeClient();
    await createSessionInvite(client, { sessionId: SESSION_A, createdBy: PSYCHOLOGIST_ID });

    const tampered = await consumeInviteToken(client, "совершенно-другая-строка");
    expect(tampered).toEqual({ ok: false, reason: "not_found" });
  });

  it("токен одной сессии не резолвится в чужую — изоляция между приглашениями разных сессий", async () => {
    const client = makeClient();
    const inviteA = await createSessionInvite(client, { sessionId: SESSION_A, createdBy: PSYCHOLOGIST_ID });
    const inviteB = await createSessionInvite(client, { sessionId: SESSION_B, createdBy: PSYCHOLOGIST_ID });
    if (!inviteA.ok || !inviteB.ok) throw new Error("setup failed");

    const resultA = await peekInviteToken(client, inviteA.rawToken);
    const resultB = await peekInviteToken(client, inviteB.rawToken);

    expect(resultA.ok && resultA.invite.session_id).toBe(SESSION_A);
    expect(resultB.ok && resultB.invite.session_id).toBe(SESSION_B);
  });

  it("гонка: два параллельных consume одного токена — успевает ровно один", async () => {
    const client = makeClient();
    const created = await createSessionInvite(client, { sessionId: SESSION_A, createdBy: PSYCHOLOGIST_ID });
    if (!created.ok) throw new Error("setup failed");

    const [first, second] = await Promise.all([
      consumeInviteToken(client, created.rawToken),
      consumeInviteToken(client, created.rawToken),
    ]);

    const results = [first, second];
    const succeeded = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toEqual({ ok: false, reason: "used" });
  });
});

describe("revokeSessionInvites", () => {
  it("отзывает только активные приглашения указанной сессии, не трогая чужие", async () => {
    const client = makeClient();
    const inviteA = await createSessionInvite(client, { sessionId: SESSION_A, createdBy: PSYCHOLOGIST_ID });
    const inviteB = await createSessionInvite(client, { sessionId: SESSION_B, createdBy: PSYCHOLOGIST_ID });
    if (!inviteA.ok || !inviteB.ok) throw new Error("setup failed");

    const result = await revokeSessionInvites(client, SESSION_A);
    expect(result).toEqual({ ok: true, revoked: 1 });

    const stillActiveB = await peekInviteToken(client, inviteB.rawToken);
    expect(stillActiveB).toEqual({ ok: true, invite: expect.objectContaining({ session_id: SESSION_B, status: "active" }) });
  });
});

describe("hashToken", () => {
  it("один и тот же токен всегда даёт один и тот же хеш, разные токены — разные хеши", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});
