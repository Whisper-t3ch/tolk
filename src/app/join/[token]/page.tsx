"use client";
import { useState, useEffect, use } from "react";
import { Check, Video, ShieldCheck } from "lucide-react";
import { buildJitsiRoomName } from "@/lib/jitsi";
import ClientCallView from "@/components/ClientCallView";

type ViewState =
  | { kind: "loading" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "ready";
      psychologistName: string;
      scheduledAt: string | null;
    }
  | { kind: "consented"; sessionId: string; psychologistName: string };

const INVALID_REASON_LABELS: Record<string, string> = {
  not_found: "Ссылка для подключения не найдена — проверьте, что скопировали её полностью",
  expired: "Срок действия ссылки истёк — попросите психолога отправить новую",
  revoked: "Эта ссылка больше не активна — попросите психолога отправить новую",
  used: "Ссылка уже использована (возможно, на другом устройстве) или сессия завершена — попросите психолога отправить новую",
};

function formatScheduledAt(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

/** Память о подключении в этом браузере: позволяет вернуться в звонок после обновления страницы. */
const JOIN_MEMO_TTL_MS = 12 * 60 * 60 * 1000;
interface JoinMemo { sessionId: string; psychologistName: string }
function joinMemoKey(token: string) { return `tolk_join_${token}`; }
function readJoinMemo(token: string): JoinMemo | null {
  try {
    const raw = localStorage.getItem(joinMemoKey(token));
    if (!raw) return null;
    const v = JSON.parse(raw) as JoinMemo & { at?: number };
    if (!v.sessionId || typeof v.at !== "number" || Date.now() - v.at > JOIN_MEMO_TTL_MS) {
      localStorage.removeItem(joinMemoKey(token));
      return null;
    }
    return { sessionId: v.sessionId, psychologistName: v.psychologistName || "Психолог" };
  } catch {
    return null;
  }
}
function saveJoinMemo(token: string, memo: JoinMemo) {
  try { localStorage.setItem(joinMemoKey(token), JSON.stringify({ ...memo, at: Date.now() })); } catch { /* без хранилища просто не будет повторного входа */ }
}
function clearJoinMemo(token: string) {
  try { localStorage.removeItem(joinMemoKey(token)); } catch { /* ignore */ }
}

export default function JoinSessionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/join/${token}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.valid) {
          // Ссылка одноразовая, но если клиент вылетел или обновил страницу в ТОМ ЖЕ браузере,
          // пускаем обратно в сессию без повторного согласия.
          if (data.reason === "used") {
            const saved = readJoinMemo(token);
            if (saved) {
              setState({ kind: "consented", sessionId: saved.sessionId, psychologistName: saved.psychologistName });
              return;
            }
          }
          setState({ kind: "invalid", reason: data.reason ?? "not_found" });
          return;
        }
        setState({
          kind: "ready",
          psychologistName: data.psychologistName ?? "Психолог",
          scheduledAt: data.scheduledAt ?? null,
        });
      } catch {
        if (!cancelled) setState({ kind: "invalid", reason: "not_found" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleConnect() {
    if (!consentChecked || submitting || state.kind !== "ready") return;
    const psychologistName = state.psychologistName;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/join/${token}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const data = await res.json();
      if (!data.ok) {
        setSubmitError(
          INVALID_REASON_LABELS[data.reason] ?? "Не удалось подключиться — попробуйте обновить страницу"
        );
        return;
      }
      // data.jitsi (clientJwt), если backend его выдал (JITSI_JWT_APP_ID/SECRET
      // настроены), сюда СОЗНАТЕЛЬНО не передаётся — см. заголовок
      // ClientCallView.tsx и jwt.ts: подключение остаётся анонимным, пока
      // отдельное решение не включит проверку токена на самой ВМ.
      saveJoinMemo(token, { sessionId: data.sessionId, psychologistName });
      setState({ kind: "consented", sessionId: data.sessionId, psychologistName });
    } catch {
      setSubmitError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
  }

  const scheduledLabel = state.kind === "ready" ? formatScheduledAt(state.scheduledAt) : null;

  // После согласия клиент попадает в звонок на весь экран, а не в компактную карточку.
  if (state.kind === "consented") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#0F1530", display: "flex", flexDirection: "column", fontFamily: "var(--font-sans)" }}>
        <div style={{ flex: "0 0 auto", padding: "8px 14px", color: "#C9D2EE", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={14} /> Безопасное одноразовое подключение · ТОЛК
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ClientCallView
            roomName={buildJitsiRoomName(state.sessionId)}
            psychologistName={state.psychologistName}
            fill
            onEnded={() => clearJoinMemo(token)}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #FBF9F5 0%, #F5F3EF 100%)",
        fontFamily: "var(--font-sans)",
        display: "flex",
        justifyContent: "center",
        padding: "32px 16px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #2D6A5C 0%, #1E7F5F 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px",
              color: "#fff",
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            Т
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
            Подключение к сессии
          </h1>
        </div>

        {state.kind === "loading" && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#6F5A3F", fontSize: 13 }}>
            Проверяю ссылку...
          </div>
        )}

        {state.kind === "invalid" && (
          <div
            style={{
              textAlign: "center",
              padding: "32px 20px",
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #E5DFD5",
              color: "#6F5A3F",
              fontSize: 13,
            }}
          >
            {INVALID_REASON_LABELS[state.reason] ?? "Ссылка недействительна"}
          </div>
        )}

        {state.kind === "ready" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #E5DFD5",
              padding: 28,
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "#E6F7F2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 12px",
                }}
              >
                <Video size={22} style={{ color: "#157347" }} />
              </div>
              <p style={{ fontSize: 15, color: "#1C1C1E", margin: 0, fontWeight: 600 }}>
                {state.psychologistName}
              </p>
              {scheduledLabel && (
                <p style={{ fontSize: 13, color: "#6F5A3F", marginTop: 4 }}>{scheduledLabel}</p>
              )}
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "14px 16px",
                background: "#F8F6F1",
                borderRadius: 12,
                cursor: "pointer",
                marginBottom: 18,
              }}
            >
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span style={{ fontSize: 13, color: "#4A4A4A", lineHeight: 1.5 }}>
                Я даю согласие на обработку моих персональных данных, включая сведения о состоянии здоровья,
                и на запись и расшифровку консультации (запись можно отклонить в любой момент у вашего психолога).
                Данные хранятся конфиденциально.{" "}
                <a href="/client-consent" target="_blank" rel="noopener noreferrer" style={{ color: "#1E6B54", textDecoration: "underline" }}>
                  Текст согласия
                </a>
                {" · "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#1E6B54", textDecoration: "underline" }}>
                  Политика конфиденциальности
                </a>
              </span>
            </label>

            {submitError && (
              <p style={{ fontSize: 13, color: "#C0392B", marginBottom: 14, textAlign: "center" }}>
                {submitError}
              </p>
            )}

            <button
              onClick={handleConnect}
              disabled={!consentChecked || submitting}
              style={{
                width: "100%",
                padding: "13px 0",
                borderRadius: 12,
                border: "none",
                background: consentChecked ? "#157347" : "#D9D4C7",
                color: consentChecked ? "#fff" : "#4B443C",
                fontSize: 15,
                fontWeight: 600,
                cursor: consentChecked && !submitting ? "pointer" : "not-allowed",
              }}
            >
              {submitting ? "Подключаю..." : "Подключиться"}
            </button>
          </div>
        )}

        <p
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 11,
            color: "#6F5A3F",
            marginTop: 20,
          }}
        >
          <ShieldCheck size={13} /> Безопасное одноразовое подключение
        </p>
      </div>
    </div>
  );
}
