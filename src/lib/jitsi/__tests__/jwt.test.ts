import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import {
  isJitsiJwtConfigured,
  signJitsiJwt,
  issuePsychologistJwt,
  issueClientJwt,
} from "../jwt";

function base64urlDecode(part: string): Buffer {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(base64urlDecode(part).toString("utf8")) as T;
}

const ORIGINAL_APP_ID = process.env.JITSI_JWT_APP_ID;
const ORIGINAL_APP_SECRET = process.env.JITSI_JWT_APP_SECRET;
const ORIGINAL_DOMAIN = process.env.NEXT_PUBLIC_JITSI_DOMAIN;

afterEach(() => {
  if (ORIGINAL_APP_ID === undefined) delete process.env.JITSI_JWT_APP_ID;
  else process.env.JITSI_JWT_APP_ID = ORIGINAL_APP_ID;
  if (ORIGINAL_APP_SECRET === undefined) delete process.env.JITSI_JWT_APP_SECRET;
  else process.env.JITSI_JWT_APP_SECRET = ORIGINAL_APP_SECRET;
  if (ORIGINAL_DOMAIN === undefined) delete process.env.NEXT_PUBLIC_JITSI_DOMAIN;
  else process.env.NEXT_PUBLIC_JITSI_DOMAIN = ORIGINAL_DOMAIN;
});

describe("isJitsiJwtConfigured / безопасный дефолт без env", () => {
  it("возвращает false, когда переменные окружения не заданы (текущее состояние — ВМ не куплена)", () => {
    delete process.env.JITSI_JWT_APP_ID;
    delete process.env.JITSI_JWT_APP_SECRET;
    expect(isJitsiJwtConfigured()).toBe(false);
  });

  it("signJitsiJwt возвращает null без env — не выдаёт токен втихую", () => {
    delete process.env.JITSI_JWT_APP_ID;
    delete process.env.JITSI_JWT_APP_SECRET;
    const token = signJitsiJwt({ roomName: "tolk-test", user: { id: "u1", moderator: true } });
    expect(token).toBeNull();
  });

  it("issuePsychologistJwt/issueClientJwt возвращают { configured: false } без env", () => {
    delete process.env.JITSI_JWT_APP_ID;
    delete process.env.JITSI_JWT_APP_SECRET;
    expect(issuePsychologistJwt({ roomName: "tolk-test", psychologistId: "p1" })).toEqual({
      configured: false,
    });
    expect(issueClientJwt({ roomName: "tolk-test" })).toEqual({ configured: false });
  });
});

describe("signJitsiJwt / структура и подпись токена, когда env заданы", () => {
  beforeEach(() => {
    process.env.JITSI_JWT_APP_ID = "test-app-id";
    process.env.JITSI_JWT_APP_SECRET = "test-app-secret-value";
    process.env.NEXT_PUBLIC_JITSI_DOMAIN = "jitsi.example.test";
  });

  it("возвращает валидный по структуре JWT (header.payload.signature) с правильными claims", () => {
    const token = signJitsiJwt({
      roomName: "tolk-abc123",
      user: { id: "psy-1", name: "Антон", moderator: true },
      ttlSeconds: 120,
    });
    expect(token).not.toBeNull();
    const parts = token!.split(".");
    expect(parts).toHaveLength(3);

    const header = decodeJwtPart<{ alg: string; typ: string }>(parts[0]);
    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");

    const payload = decodeJwtPart<{
      aud: string;
      iss: string;
      sub: string;
      room: string;
      iat: number;
      exp: number;
      context: { user: { id: string; name?: string; moderator: boolean } };
    }>(parts[1]);
    expect(payload.aud).toBe("test-app-id");
    expect(payload.iss).toBe("test-app-id");
    expect(payload.sub).toBe("jitsi.example.test");
    expect(payload.room).toBe("tolk-abc123");
    expect(payload.context.user.id).toBe("psy-1");
    expect(payload.context.user.name).toBe("Антон");
    expect(payload.context.user.moderator).toBe(true);
    expect(payload.exp - payload.iat).toBe(120);
  });

  it("подпись верифицируется пересчётом HMAC-SHA256 тем же секретом", () => {
    const token = signJitsiJwt({ roomName: "tolk-verify", user: { id: "u1", moderator: false } });
    const [headerPart, payloadPart, signaturePart] = token!.split(".");
    const expectedSig = createHmac("sha256", "test-app-secret-value")
      .update(`${headerPart}.${payloadPart}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(signaturePart).toBe(expectedSig);
  });

  it("другой секрет даёт другую подпись при идентичных header/payload", () => {
    const tokenA = signJitsiJwt({ roomName: "tolk-same-room", user: { id: "u1", moderator: false } });
    process.env.JITSI_JWT_APP_SECRET = "different-secret";
    const tokenB = signJitsiJwt({ roomName: "tolk-same-room", user: { id: "u1", moderator: false } });
    const sigA = tokenA!.split(".")[2];
    const sigB = tokenB!.split(".")[2];
    expect(sigA).not.toBe(sigB);
  });

  it("использует DEFAULT_TTL_SECONDS (180с), если ttlSeconds не передан", () => {
    const token = signJitsiJwt({ roomName: "tolk-default-ttl", user: { id: "u1", moderator: false } });
    const payload = decodeJwtPart<{ iat: number; exp: number }>(token!.split(".")[1]);
    expect(payload.exp - payload.iat).toBe(180);
  });
});

describe("issuePsychologistJwt / issueClientJwt — выбор роли и moderator-флага", () => {
  beforeEach(() => {
    process.env.JITSI_JWT_APP_ID = "test-app-id";
    process.env.JITSI_JWT_APP_SECRET = "test-app-secret-value";
    process.env.NEXT_PUBLIC_JITSI_DOMAIN = "jitsi.example.test";
  });

  it("issuePsychologistJwt выдаёт moderator: true", () => {
    const result = issuePsychologistJwt({ roomName: "tolk-room-1", psychologistId: "psy-1", displayName: "Иван" });
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    const payload = decodeJwtPart<{ context: { user: { moderator: boolean; id: string; name?: string } } }>(
      result.token.split(".")[1]
    );
    expect(payload.context.user.moderator).toBe(true);
    expect(payload.context.user.id).toBe("psy-1");
    expect(payload.context.user.name).toBe("Иван");
    expect(result.room).toBe("tolk-room-1");
    expect(result.domain).toBe("jitsi.example.test");
  });

  it("issueClientJwt выдаёт moderator: false и не раскрывает внутренний client.id", () => {
    const result = issueClientJwt({ roomName: "tolk-room-1", clientDisplayName: "Клиент" });
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    const payload = decodeJwtPart<{ context: { user: { moderator: boolean; id: string; name?: string } } }>(
      result.token.split(".")[1]
    );
    expect(payload.context.user.moderator).toBe(false);
    expect(payload.context.user.id).toBe("client");
    expect(payload.context.user.name).toBe("Клиент");
  });

  it("expiresAt в результате согласован с exp из токена (в пределах секунды)", () => {
    const result = issuePsychologistJwt({ roomName: "tolk-room-2", psychologistId: "psy-1", ttlSeconds: 60 });
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    const payload = decodeJwtPart<{ exp: number }>(result.token.split(".")[1]);
    const expMs = payload.exp * 1000;
    const resultMs = new Date(result.expiresAt).getTime();
    expect(Math.abs(expMs - resultMs)).toBeLessThan(1500);
  });
});
