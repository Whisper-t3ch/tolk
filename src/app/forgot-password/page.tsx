"use client";
import { useState } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

// Запрос письма для сброса пароля. Ответ всегда одинаковый (не раскрываем, есть ли такой email).
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!email.trim()) { setError("Укажите email"); return; }
    setLoading(true);
    const { error: e } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (e && /rate|seconds|too many/i.test(e.message)) { setError("Слишком часто. Попробуйте через минуту."); return; }
    setSent(true);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #F5F3EF 0%, #F0EDE5 50%, #E8F2EF 100%)", padding: 24, fontFamily: "var(--font-sans)" }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#FFFFFF", borderRadius: 20, padding: "40px 36px", boxShadow: "0 20px 60px rgba(45, 106, 92, 0.12)", border: "1px solid #E5DFD5" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display: "inline-flex", marginBottom: 12 }}><LogoMark size={48} /></div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1C1C1E" }}>Восстановление пароля</h1>
        </div>
        {sent ? (
          <p style={{ fontSize: 14, color: "#1C1C1E", lineHeight: 1.5 }}>
            Если такой аккаунт есть, мы отправили на {email.trim()} письмо со ссылкой для нового пароля. Проверьте также папку «Спам». Не пришло — напишите в поддержку: tolkplace@gmail.com.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "#6F5A3F", margin: 0 }}>Укажите email аккаунта — пришлём ссылку для создания нового пароля.</p>
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              style={{ padding: "11px 14px", border: "1px solid #E5DFD5", borderRadius: 10, fontSize: 14, outline: "none", color: "#1C1C1E", width: "100%", boxSizing: "border-box" }} />
            {error && <p style={{ fontSize: 12.5, color: "#B91C1C", background: "#FEE2E2", borderRadius: 8, padding: "8px 12px", margin: 0 }}>{error}</p>}
            <button onClick={submit} disabled={loading}
              style={{ padding: 12, background: loading ? "#1F4E43" : "#2D6A5C", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Отправляем..." : "Отправить ссылку"}
            </button>
          </div>
        )}
        <p style={{ textAlign: "center", marginTop: 20, fontSize: 12.5 }}>
          <Link href="/login" style={{ color: "#2D6A5C", textDecoration: "underline" }}>Вернуться ко входу</Link>
        </p>
      </div>
    </div>
  );
}
