"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

// Регистрация новых аккаунтов временно закрыта (беста-набор завершён).
// Настоящая блокировка — на уровне Supabase Auth (Dashboard → Authentication →
// Settings → Allow new users to sign up: выключено). Этот флаг в UI —
// дополнительный барьер, чтобы форма даже не пыталась вызвать signUp.
const REGISTRATION_OPEN = false;

function LoginForm() {
  const searchParams = useSearchParams();
  const initialMode = REGISTRATION_OPEN && searchParams.get("mode") === "register" ? "register" : "login";

  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consentChecked, setConsentChecked] = useState(true);

  async function handleSubmit() {
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Заполните email и пароль");
      return;
    }
    if (mode === "register" && !name.trim()) {
      setError("Укажите имя");
      return;
    }
    if (mode === "register" && !consentChecked) {
      setError("Нужно согласие на обработку персональных данных");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    if (mode === "register") {
      if (!REGISTRATION_OPEN) {
        setError("Регистрация новых аккаунтов сейчас закрыта");
        setLoading(false);
        return;
      }
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
        },
      });
      if (signUpError) {
        setError(translateAuthError(signUpError.message));
        setLoading(false);
        return;
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(translateAuthError(signInError.message));
        setLoading(false);
        return;
      }
    }

    // Полная перезагрузка (а не router.push) — иначе ClientsProvider в layout
    // может успеть запросить /clients раньше, чем cookie с сессией долетит
    // до Supabase-клиента, и RLS молча вернёт пустой список без ошибки
    // (список клиентов тогда появляется только после ручного обновления).
    window.location.href = "/dashboard";
  }

  function translateAuthError(message: string): string {
    if (message.includes("Invalid login credentials")) return "Неверный email или пароль";
    if (message.includes("User already registered")) return "Этот email уже зарегистрирован — попробуйте войти";
    if (message.includes("Password should be at least")) return "Пароль слишком короткий (минимум 6 символов)";
    if (message.includes("Unable to validate email")) return "Некорректный email";
    return "Не получилось выполнить действие — попробуйте ещё раз";
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

        {/* Переключатель Вход / Регистрация — регистрация скрыта, пока набор закрыт */}
        {REGISTRATION_OPEN && (
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
        )}

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
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                style={{ marginTop: 2, accentColor: "#2D6A5C" }}
              />
              Согласен(на) с условиями обработки персональных данных и офертой
            </label>
          )}
          {error && (
            <p style={{
              fontSize: 12.5, color: "#EF4444",
              background: "#FEE2E2", borderRadius: 8,
              padding: "8px 12px", margin: 0,
            }}>
              {error}
            </p>
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
            ? "Ещё нет аккаунта? Переключитесь на «Регистрация»"
            : "После регистрации на почту может прийти письмо для подтверждения"}
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
