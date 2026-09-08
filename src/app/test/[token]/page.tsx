"use client";
import { useState, useEffect, use, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ClipboardList } from "lucide-react";

interface ResponseOption {
  value: number;
  label: string;
}

interface Question {
  id: string;
  text: string;
  responseScale?: ResponseOption[];
}

export default function PublicTestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState<string | null>(null);
  const [responseScale, setResponseScale] = useState<ResponseOption[] | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ score: number; maxScore: number; interpretation: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/test/${token}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Тест не найден");
          return;
        }
        if (data.status === "completed") {
          setAlreadyCompleted(true);
          return;
        }
        setTitle(data.title ?? "Тест");
        setInstructions(data.instructions ?? null);
        setResponseScale(data.responseScale ?? null);
        setQuestions(data.questions ?? []);
      } catch {
        if (!cancelled) setError("Не удалось загрузить тест — проверьте соединение");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  async function submit() {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/test/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ score: data.score, maxScore: data.maxScore, interpretation: data.interpretation });
      } else {
        setSubmitError(data.error ?? "Не удалось отправить ответы");
      }
    } catch {
      setSubmitError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
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
      <div style={{ width: "100%", maxWidth: 560 }}>
        {/* Шапка */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px", color: "#fff", fontSize: 22, fontWeight: 800,
          }}>
            Т
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
            {loading ? "Тест" : title || "Тест"}
          </h1>
          {!loading && instructions && (
            <p style={{ fontSize: 13, color: "#8C7355", marginTop: 6, lineHeight: 1.5 }}>{instructions}</p>
          )}
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#8C7355", fontSize: 13 }}>
            Загружаю вопросы...
          </div>
        )}

        {!loading && error && (
          <div style={{
            textAlign: "center", padding: "32px 20px", background: "#fff",
            borderRadius: 16, border: "1px solid #E5DFD5", color: "#8C7355", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {!loading && !error && alreadyCompleted && (
          <div style={{
            background: "#fff", borderRadius: 16, border: "1px solid #E5DFD5",
            padding: 28, textAlign: "center",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "#E6F7F2",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <Check size={24} style={{ color: "#1BAF7A" }} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1C1C1E", marginBottom: 8 }}>
              Этот тест уже пройден
            </h2>
            <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6 }}>
              Результат уже отправлен психологу — повторно пройти по этой ссылке нельзя.
            </p>
          </div>
        )}

        {!loading && !error && !alreadyCompleted && result && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              background: "#fff", borderRadius: 16, border: "1px solid #E5DFD5",
              padding: 28, textAlign: "center",
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "#E6F7F2",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <Check size={24} style={{ color: "#1BAF7A" }} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1C1C1E", marginBottom: 8 }}>
              Спасибо, ответы отправлены
            </h2>
            <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6 }}>
              Результат увидит ваш психолог. Обсудите его на следующей встрече.
            </p>
          </motion.div>
        )}

        {!loading && !error && !alreadyCompleted && !result && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              {questions.map((q, idx) => {
                const scale = q.responseScale ?? responseScale ?? [];
                return (
                  <div
                    key={q.id}
                    style={{
                      background: "#fff", borderRadius: 14, border: "1px solid #E5DFD5",
                      padding: 16,
                    }}
                  >
                    <p style={{ fontSize: 13.5, fontWeight: 600, color: "#1C1C1E", marginBottom: 12, lineHeight: 1.5 }}>
                      {idx + 1}. {q.text}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {scale.map(option => {
                        const selected = answers[q.id] === option.value;
                        return (
                          <button
                            key={option.value}
                            onClick={() => setAnswers(prev => ({ ...prev, [q.id]: option.value }))}
                            style={{
                              textAlign: "left", padding: "9px 12px", borderRadius: 8, cursor: "pointer",
                              fontSize: 13, fontFamily: "var(--font-sans)",
                              border: selected ? "1.5px solid #2D6A5C" : "1px solid #E5DFD5",
                              background: selected ? "#E8F2EF" : "#fff",
                              color: selected ? "#2D6A5C" : "#1C1C1E",
                              fontWeight: selected ? 700 : 400,
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <AnimatePresence>
              {questions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{
                    position: "sticky", bottom: 16, background: "#fff",
                    borderRadius: 14, border: "1px solid #E5DFD5", padding: 14,
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#6B6058" }}>
                    <ClipboardList size={14} style={{ color: "#2D6A5C" }} />
                    Отвечено {answeredCount} из {questions.length}
                  </div>
                  <button
                    onClick={submit}
                    disabled={!allAnswered || submitting}
                    style={{
                      padding: "10px 18px", borderRadius: 10, border: "none",
                      background: allAnswered ? "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)" : "#E5DFD5",
                      color: allAnswered ? "#fff" : "#8C7355",
                      fontSize: 13.5, fontWeight: 700, cursor: allAnswered ? "pointer" : "default",
                      fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
                      opacity: submitting ? 0.7 : 1,
                    }}
                  >
                    {submitting ? "Отправляю..." : "Отправить ответы"}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            {submitError && (
              <p style={{ fontSize: 12.5, color: "#EF4444", marginTop: 10, textAlign: "center" }}>{submitError}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
