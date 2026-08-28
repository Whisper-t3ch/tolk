"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { APPROACH_LABELS, SPECIALTY_OPTIONS, type Approach } from "@/lib/approaches";

// ------------------------------------------------------------
// Обязательный онбординг психолога: если approach/specialty ещё не
// заполнены — блокирует доступ к кабинету модальным окном, пока
// психолог не ответит на 3 вопроса. Ответы используются для адаптации
// системного промпта ассистента (см. /api/assistant) и предзаполнения
// базы знаний (см. /api/onboarding).
// ------------------------------------------------------------
export default function OnboardingGate() {
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [approach, setApproach] = useState<Approach>("cbt");
  const [specialty, setSpecialty] = useState(SPECIALTY_OPTIONS[0]);
  const [typicalRequest, setTypicalRequest] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/onboarding");
        const data = await res.json();
        if (!cancelled && res.ok) {
          setNeedsOnboarding(Boolean(data.needsOnboarding));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async () => {
    if (!typicalRequest.trim()) {
      setError("Опишите типичный запрос ваших клиентов — хотя бы одним предложением");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approach,
          specialty,
          typical_client_request: typicalRequest.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNeedsOnboarding(false);
      } else {
        setError(data.error ?? "Не удалось сохранить — попробуйте ещё раз");
      }
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !needsOnboarding) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(28,28,30,0.55)",
          backdropFilter: "blur(4px)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          style={{
            background: "#FFFFFF",
            borderRadius: 16,
            padding: 32,
            maxWidth: 480,
            width: "100%",
            maxHeight: "90vh",
            overflowY: "auto",
            boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1C1C1E", marginBottom: 6 }}>
            Пара вопросов перед началом
          </h2>
          <p style={{ fontSize: 13, color: "#6B6058", marginBottom: 24, lineHeight: 1.5 }}>
            Это поможет ИИ-ассистенту сразу отвечать в вашем стиле и подготовит базу знаний с техниками под ваш подход.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                Ваш основной подход
              </label>
              <select
                value={approach}
                onChange={e => setApproach(e.target.value as Approach)}
                style={{
                  width: "100%", padding: "10px 12px", border: "1px solid #E5DFD5", borderRadius: 8,
                  fontSize: 13.5, color: "#1C1C1E", background: "#FFFFFF", boxSizing: "border-box",
                }}
              >
                {(Object.entries(APPROACH_LABELS) as [Approach, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                Специализация
              </label>
              <select
                value={specialty}
                onChange={e => setSpecialty(e.target.value)}
                style={{
                  width: "100%", padding: "10px 12px", border: "1px solid #E5DFD5", borderRadius: 8,
                  fontSize: 13.5, color: "#1C1C1E", background: "#FFFFFF", boxSizing: "border-box",
                }}
              >
                {SPECIALTY_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                Типичный запрос ваших клиентов
              </label>
              <textarea
                value={typicalRequest}
                onChange={e => setTypicalRequest(e.target.value)}
                placeholder="Например: тревожность и выгорание на фоне переработок"
                rows={3}
                style={{
                  width: "100%", padding: "10px 12px", border: "1px solid #E5DFD5", borderRadius: 8,
                  fontSize: 13.5, color: "#1C1C1E", background: "#FFFFFF", boxSizing: "border-box",
                  fontFamily: "var(--font-sans)", resize: "vertical",
                }}
              />
            </div>

            {error && (
              <p style={{ fontSize: 12.5, color: "#EF4444", margin: 0 }}>{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                padding: "12px 16px",
                background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
                border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1,
                boxShadow: "0 4px 14px rgba(45,106,92,0.3)",
              }}
            >
              {submitting ? "Сохраняем…" : "Продолжить"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
