import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getSession } }) }));

import { GET, POST } from "../route";
import { NextRequest } from "next/server";

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new NextRequest(`http://app.test${url}`, init);

describe("/api/sb прокси", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.example.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    fetchMock.mockReset();
    getSession.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("без служебного заголовка — 403", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "T" } } });
    const res = await GET(req("/api/sb/rest/v1/clients"), ctx(["rest", "v1", "clients"]));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auth и прочие пути не проксируются", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "T" } } });
    const res = await GET(req("/api/sb/auth/v1/user", { headers: { "x-tolk-proxy": "1" } }), ctx(["auth", "v1", "user"]));
    expect(res.status).toBe(404);
  });

  it("без сессии — 401", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const res = await GET(req("/api/sb/rest/v1/clients", { headers: { "x-tolk-proxy": "1" } }), ctx(["rest", "v1", "clients"]));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("подставляет токен из куки, не пропускает чужой Authorization и cookie, возвращает ответ базы", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "REAL" } } });
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { "content-type": "application/json", "set-cookie": "x=1" } }));
    const res = await GET(
      req("/api/sb/rest/v1/clients?select=id", { headers: { "x-tolk-proxy": "1", authorization: "Bearer anon", cookie: "sb-db-auth-token=secret", prefer: "count=exact" } }),
      ctx(["rest", "v1", "clients"])
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(res.headers.get("set-cookie")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.example.test/rest/v1/clients?select=id");
    const h = init.headers as Headers;
    expect(h.get("authorization")).toBe("Bearer REAL");
    expect(h.get("apikey")).toBe("anon-key");
    expect(h.get("cookie")).toBeNull();
    expect(h.get("prefer")).toBe("count=exact");
  });

  it("передаёт тело POST", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "REAL" } } });
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    const res = await POST(
      req("/api/sb/rest/v1/clients", { method: "POST", headers: { "x-tolk-proxy": "1", "content-type": "application/json" }, body: JSON.stringify({ name: "A" }) }),
      ctx(["rest", "v1", "clients"])
    );
    expect(res.status).toBe(201);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });
});
