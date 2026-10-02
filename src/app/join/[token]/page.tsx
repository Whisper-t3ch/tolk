"use client";
import { useState, useEffect, use } from "react";
import { Check, Video, ShieldCheck } from "lucide-react";

type ViewState =
  | { kind: "loading" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "ready";
      psychologistName: string;
      scheduledAt: string | null;
    }
  | { kind: "consented" };

const INVALID_REASON_LABELS: Record<string, string> = {
  not_found: "Ссылка для подключения не найдена — проверьте, что скопировали её полностью",
  expired: "Срок действия ссылки истёк — попросите психолога отправить новую",
  revoked: "Эта ссылка больше не активна — попросите психолога отправить новую",
  used: "Эта ссылка уже была использована для подключения",
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
    if (!consentChecked || submitting) return;
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
      setState({ kind: "consented" });
    } catch {
      setSubmitError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
  }

  const scheduledLabel = state.kind === "ready" ? formatScheduledAt(state.scheduledAt) : null;

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
              background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
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
          <div style={{ textAlign: "center", padding: "48px 0", color: "#8C7355", fontSize: 13 }}>
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
              color: "#8C7355",
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
                <Video size={22} style={{ color: "#1BAF7A" }} />
              </div>
              <p style={{ fontSize: 15, color: "#1C1C1E", margin: 0, fontWeight: 600 }}>
                {state.psychologistName}
              </p>
              {scheduledLabel && (
                <p style={{ fontSize: 13, color: "#8C7355", marginTop: 4 }}>{scheduledLabel}</p>
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
                Я согласен(на), что консультация будет записана для последующей обработки
                психологом. Запись хранится конфиденциально.
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
                background: consentChecked ? "#1BAF7A" : "#D9D4C7",
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
                cursor: consentChecked && !submitting ? "pointer" : "not-allowed",
              }}
            >
              {submitting ? "Подключаю..." : "Подключиться"}
            </button>
          </div>
        )}

        {state.kind === "consented" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #E5DFD5",
              padding: 28,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "#E6F7F2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <Check size={24} style={{ color: "#1BAF7A" }} />
            </div>
            <p style={{ fontSize: 15, color: "#1C1C1E", fontWeight: 600, marginBottom: 8 }}>
              Согласие подтверждено
            </p>
            <p style={{ fontSize: 13, color: "#8C7355", lineHeight: 1.5 }}>
              Подключение к видеозвонку станет доступно здесь на следующем этапе.
              Пока эта ссылка больше не может быть использована повторно.
            </p>
          </div>
        )}

        <p
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 11,
            color: "#B8AF9E",
            marginTop: 20,
          }}
        >
          <ShieldCheck size={13} /> Безопасное одноразовое подключение
        </p>
      </div>
    </div>
  );
}
