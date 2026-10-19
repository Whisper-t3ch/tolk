"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

// Страница нового пароля: сюда ведёт ссылка из письма (?code=… — PKCE, обмен делает supabase-js).
export default function ResetPasswordPage() {
  const [ready, setReady] = useState<"wait" | "ok" | "bad">("wait");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; setReady(ok ? "ok" : "bad"); } };
    (async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (e) { const { data } = await supabase.auth.getSession(); finish(!!data.session); return; }
        finish(true);
        return;
      }
      const { data } = await supabase.auth.getSession();
      finish(!!data.session);
    })();
    const t = setTimeout(() => finish(false), 8000);
    return () => clearTimeout(t);
  }, []);

  async function submit() {
    setError(null);
    if (password.length < 6) { setError("Пароль — минимум 6 символов"); return; }
    setLoading(true);
    const { error: e } = await createClient().auth.updateUser({ password });
    if (e) {
      setError(/same|different/i.test(e.message) ? "Новый пароль должен отличаться от старого" : "Не получилось сменить пароль — запросите ссылку заново");
      setLoading(false);
      return;
    }
    window.location.href = "/dashboard";
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #F5F3EF 0%, #F0EDE5 50%, #E8F2EF 100%)", padding: 24, fontFamily: "var(--font-sans)" }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#FFFFFF", borderRadius: 20, padding: "40px 36px", boxShadow: "0 20px 60px rgba(45, 106, 92, 0.12)", border: "1px solid #E5DFD5" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display: "inline-flex", marginBottom: 12 }}><LogoMark size={48} /></div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1C1C1E" }}>Новый пароль</h1>
        </div>
        {ready === "wait" && <p style={{ fontSize: 14, color: "#6F5A3F", textAlign: "center" }}>Проверяем ссылку…</p>}
        {ready === "bad" && (
          <p style={{ fontSize: 14, color: "#1C1C1E", lineHeight: 1.5 }}>
            Ссылка устарела или уже использована. <Link href="/forgot-password" style={{ color: "#2D6A5C", textDecoration: "underline" }}>Запросить новую</Link>. Откройте её в том же браузере, где запрашивали.
          </p>
        )}
        {ready === "ok" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ position: "relative" }}>
              <input type={show ? "text" : "password"} placeholder="Новый пароль (от 6 символов)" value={password}
                onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                style={{ padding: "11px 80px 11px 14px", border: "1px solid #E5DFD5", borderRadius: 10, fontSize: 14, outline: "none", color: "#1C1C1E", width: "100%", boxSizing: "border-box" }} />
              <button type="button" onClick={() => setShow((v) => !v)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#2D6A5C", padding: "4px 6px" }}>
                {show ? "Скрыть" : "Показать"}
              </button>
            </div>
            {error && <p style={{ fontSize: 12.5, color: "#B91C1C", background: "#FEE2E2", borderRadius: 8, padding: "8px 12px", margin: 0 }}>{error}</p>}
            <button onClick={submit} disabled={loading}
              style={{ padding: 12, background: loading ? "#1F4E43" : "#2D6A5C", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Сохраняем..." : "Сохранить пароль"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
