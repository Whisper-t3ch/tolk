"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "register" ? "register" : "login";

  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("maria@tolk.pro");
  const [password, setPassword] = useState("••••••••");

  function handleSubmit() {
    setLoading(true);
    setTimeout(() => router.push("/dashboard"), 800);
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(180deg, #F5F3EF 0%, #F0EDE5 50%, #E8F2EF 100%)",
      padding: 24,
      fontFamily: "var(--font-sans)",
    }}>
      <div style={{
        width: "100%", maxWidth: 400,
        background: "#FFFFFF",
        borderRadius: 20,
        padding: "40px 36px",
        boxShadow: "0 20px 60px rgba(45, 106, 92, 0.12)",
        border: "1px solid #E5DFD5",
      }}>
        {/* Логотип */}
        <Link href="/" style={{ display: "block", textAlign: "center", marginBottom: 28, textDecoration: "none" }}>
          <div style={{ display: "inline-flex", justifyContent: "center", marginBottom: 14 }}>
            <LogoMark size={48} />
          </div>
          <h1 style={{
            fontSize: 22, fontWeight: 800,
            color: "#1C1C1E", letterSpacing: "0.01em",
          }}>ТОЛК</h1>
          <p style={{
            fontSize: 12.5, color: "#8C7355",
            marginTop: 4,
          }}>среда для психологов</p>
        </Link>

        {/* Переключатель Вход / Регистрация */}
        <div style={{
          display: "flex",
          background: "#F5F3EF",
          borderRadius: 10,
          padding: 4,
          marginBottom: 24,
          gap: 4,
        }}>
          {([
            { id: "login" as const, label: "Вход" },
            { id: "register" as const, label: "Регистрация" },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              style={{
                flex: 1,
                padding: "9px 0",
                border: "none",
                borderRadius: 8,
                background: mode === tab.id ? "#FFFFFF" : "transparent",
                color: mode === tab.id ? "#2D6A5C" : "#8C7355",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: mode === tab.id ? "0 1px 4px rgba(15,22,41,0.08)" : "none",
                transition: "all 0.2s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Форма */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "register" && (
            <input
              type="text"
              placeholder="Имя и фамилия"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                padding: "11px 14px",
                border: "1px solid #E5DFD5",
                borderRadius: 10,
                fontSize: 14,
                outline: "none",
                color: "#1C1C1E",
                fontFamily: "var(--font-sans)",
              }}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: "11px 14px",
              border: "1px solid #E5DFD5",
              borderRadius: 10,
              fontSize: 14,
              outline: "none",
              color: "#1C1C1E",
              fontFamily: "var(--font-sans)",
            }}
          />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: "11px 14px",
              border: "1px solid #E5DFD5",
              borderRadius: 10,
              fontSize: 14,
              outline: "none",
              color: "#1C1C1E",
              fontFamily: "var(--font-sans)",
            }}
          />
          {mode === "register" && (
            <label style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              fontSize: 11.5, color: "#6B6058", lineHeight: 1.4,
              marginTop: 2, cursor: "pointer",
            }}>
              <input type="checkbox" defaultChecked style={{ marginTop: 2, accentColor: "#2D6A5C" }} />
              Согласен(на) с условиями обработки персональных данных и офертой
            </label>
          )}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              marginTop: 4,
              padding: "12px",
              background: loading ? "#1F4E43" : "#2D6A5C",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {loading
              ? (mode === "login" ? "Входим..." : "Создаём аккаунт...")
              : (mode === "login" ? "Войти в кабинет" : "Создать аккаунт")}
          </button>
        </div>

        <p style={{
          textAlign: "center", marginTop: 20,
          fontSize: 12, color: "#8C7355",
        }}>
          {mode === "login"
            ? "Любой email и пароль для демо-доступа"
            : "Демо-режим — данные не сохраняются"}
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
