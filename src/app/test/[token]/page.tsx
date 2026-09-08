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

interface RankingItem {
  id: string;
  text: string;
}

interface RankingGroup {
  key: string;
  label: string;
  items: RankingItem[];
}

export default function PublicTestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState<string | null>(null);
  const [testType, setTestType] = useState<"likert" | "ranking">("likert");
  const [responseScale, setResponseScale] = useState<ResponseOption[] | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [rankingGroups, setRankingGroups] = useState<RankingGroup[]>([]);

  const [answers, setAnswers] = useState<Record<string, number>>({});
  // Для ranking: groupKey -> порядок id пунктов, от самого значимого к наименее.
  const [rankingAnswers, setRankingAnswers] = useState<Record<string, string[]>>({});
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
        if (data.type === "ranking") {
          setTestType("ranking");
          setRankingGroups(data.rankingGroups ?? []);
        } else {
          setTestType("likert");
          setResponseScale(data.responseScale ?? null);
          setQuestions(data.questions ?? []);
        }
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
  const allRanked = rankingGroups.length > 0 && rankingGroups.every(g => (rankingAnswers[g.key]?.length ?? 0) === g.items.length);
  const canSubmit = testType === "ranking" ? allRanked : allAnswered;

  // Клик по пункту в ranking-группе — добавляет его следующим номером в
  // порядке значимости; повторный клик по уже выбранному пункту снимает
  // выбор (и сдвигает номера следующих за ним вверх).
  function toggleRankingItem(groupKey: string, itemId: string) {
    setRankingAnswers(prev => {
      const current = prev[groupKey] ?? [];
      const next = current.includes(itemId) ? current.filter(id => id !== itemId) : [...current, itemId];
      return { ...prev, [groupKey]: next };
    });
  }

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/test/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testType === "ranking" ? { rankingAnswers } : { answers }),
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

        {!loading && !error && !alreadyCompleted && !result && testType === "ranking" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 16 }}>
              {rankingGroups.map(group => {
                const order = rankingAnswers[group.key] ?? [];
                return (
                  <div key={group.key} style={{ background: "#fff", borderRadius: 14, border: "1px solid #E5DFD5", padding: 16 }}>
                    {group.label && (
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: "#1C1C1E", marginBottom: 6 }}>{group.label}</p>
                    )}
                    <p style={{ fontSize: 12, color: "#8C7355", marginBottom: 12, lineHeight: 1.5 }}>
                      Нажимайте на пункты по порядку — от самого важного для вас к наименее важному.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {group.items.map(item => {
                        const rank = order.indexOf(item.id);
                        const selected = rank !== -1;
                        return (
                          <button
                            key={item.id}
                            onClick={() => toggleRankingItem(group.key, item.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: 10,
                              textAlign: "left", padding: "9px 12px", borderRadius: 8, cursor: "pointer",
                              fontSize: 13, fontFamily: "var(--font-sans)",
                              border: selected ? "1.5px solid #2D6A5C" : "1px solid #E5DFD5",
                              background: selected ? "#E8F2EF" : "#fff",
                              color: selected ? "#2D6A5C" : "#1C1C1E",
                              fontWeight: selected ? 700 : 400,
                            }}
                          >
                            <span style={{
                              width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 11, fontWeight: 700,
                              background: selected ? "#2D6A5C" : "#E5DFD5",
                              color: selected ? "#fff" : "#8C7355",
                            }}>
                              {selected ? rank + 1 : ""}
                            </span>
                            {item.text}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <AnimatePresence>
              {rankingGroups.length > 0 && (
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
                    {allRanked ? "Все пункты расставлены" : "Расставьте все пункты по порядку"}
                  </div>
                  <button
                    onClick={submit}
                    disabled={!canSubmit || submitting}
                    style={{
                      padding: "10px 18px", borderRadius: 10, border: "none",
                      background: canSubmit ? "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)" : "#E5DFD5",
                      color: canSubmit ? "#fff" : "#8C7355",
                      fontSize: 13.5, fontWeight: 700, cursor: canSubmit ? "pointer" : "default",
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

        {!loading && !error && !alreadyCompleted && !result && testType === "likert" && (
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
