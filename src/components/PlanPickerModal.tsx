"use client";
import { useState } from "react";
import { X, Check } from "lucide-react";

const PLANS = [
  { key: "practice", label: "Практика", requests: 60, hint: "Для небольшой практики" },
  { key: "professional", label: "Профессионал", requests: 200, hint: "Для активной практики" },
  { key: "expert", label: "Эксперт", requests: 600, hint: "Для большой нагрузки" },
] as const;

/** Выбор тарифа. Оплата пока не подключена — тариф переключается сразу. */
export default function PlanPickerModal({
  currentKey,
  onClose,
  onChanged,
}: {
  currentKey: string;
  onClose: () => void;
  onChanged: (planLabel: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(key: string, label: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/profile/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось сменить тариф");
      onChanged(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сменить тариф");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60 }} />
      <div
        role="dialog"
        aria-label="Выбор тарифа"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "92%", maxWidth: 460, background: "#FFFFFF", borderRadius: 16,
          boxShadow: "0 25px 80px rgba(0,0,0,0.2)", padding: 24, zIndex: 61,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>Сменить тариф</h3>
          <button onClick={onClose} aria-label="Закрыть" style={{ background: "none", border: "none", cursor: "pointer", color: "#6B6058" }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "#6B6058", margin: "0 0 16px" }}>
          Бета-тестирование: оплата пока не подключена, тариф меняется сразу. Использованные в этом месяце запросы сохраняются.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PLANS.map(p => {
            const current = p.key === currentKey;
            return (
              <button
                key={p.key}
                disabled={current || busy !== null}
                onClick={() => choose(p.key, p.label)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 14px", borderRadius: 10, textAlign: "left",
                  border: current ? "2px solid #2D6A5C" : "1px solid #D9D2C5",
                  background: current ? "#E8F2EF" : "#FFFFFF",
                  cursor: current || busy ? "default" : "pointer",
                }}
              >
                <span>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>{p.label}</span>
                  <span style={{ display: "block", fontSize: 12, color: "#4B443C" }}>
                    {p.requests} запросов к ассистенту в месяц · {p.hint}
                  </span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#2D6A5C", display: "flex", alignItems: "center", gap: 4 }}>
                  {current ? <><Check size={14} /> Текущий</> : busy === p.key ? "…" : "Выбрать"}
                </span>
              </button>
            );
          })}
        </div>
        {error && <p style={{ fontSize: 12.5, color: "#B91C1C", marginTop: 12 }}>{error}</p>}
      </div>
    </>
  );
}
