"use client";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, AlertCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface ProgressScaleProps {
  clientName: string;
  progress: {
    aiScore: number;
    psychologistScore: number | null;
    clientScore: number | null;
    history: Array<{ date: string; aiScore: number; psychologistScore?: number; clientScore?: number }>;
  };
}

export default function ClientProgressScale({ clientName, progress }: ProgressScaleProps) {
  const [editMode, setEditMode] = useState(false);
  const [psychologistScore, setPsychologistScore] = useState(progress.psychologistScore ?? progress.aiScore);
  const [clientSelfScore, setClientSelfScore] = useState(progress.clientScore ?? null);
  const [showClientInput, setShowClientInput] = useState(false);

  const trend = useMemo(() => {
    if (progress.history.length < 2) return "stable";
    const recent = progress.history.slice(-2);
    const prev = recent[0].aiScore;
    const curr = recent[1].aiScore;
    if (curr > prev) return "improving";
    if (curr < prev) return "degrading";
    return "stable";
  }, [progress.history]);

  const trendColor = trend === "improving" ? "#1BAF7A" : trend === "degrading" ? "#EF4444" : "#F59E0B";
  const TrendIcon = trend === "improving" ? TrendingUp : trend === "degrading" ? TrendingDown : Minus;

  const chartData = progress.history.map(item => ({
    date: item.date,
    ai: item.aiScore,
    psychologist: item.psychologistScore ?? item.aiScore,
    client: item.clientScore ?? null,
  }));

  const discrepancy = psychologistScore && clientSelfScore
    ? Math.abs(psychologistScore - clientSelfScore)
    : null;

  const renderScoreCard = (label: string, score: number | null, color: string, bgColor: string) => {
    if (score === null) return null;
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "16px",
          background: bgColor,
          borderRadius: 12,
          border: `2px solid ${color}40`,
          flex: 1,
          minWidth: 120,
        }}
      >
        <div style={{ fontSize: 11, color: "#8C7355", fontWeight: 600, marginBottom: 8 }}>
          {label}
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color, marginBottom: 4 }}>
          {score > 0 ? "+" : ""}{score}
        </div>
        <div style={{ fontSize: 10, color: "#8C7355" }}>
          {score >= 4 ? "Значительный прогресс" : score >= 2 ? "Хороший прогресс" : score >= 0 ? "Стабильно" : "Требует внимания"}
        </div>
      </motion.div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Заголовок */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
          Шкала прогресса
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: `${trendColor}20`,
            borderRadius: 20,
            border: `1px solid ${trendColor}40`,
          }}>
            <TrendIcon size={16} style={{ color: trendColor }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: trendColor }}>
              {trend === "improving" ? "Улучшение" : trend === "degrading" ? "Ухудшение" : "Стабильно"}
            </span>
          </div>
        </div>
      </div>

      {/* Текущие оценки */}
      <div style={{
        background: "#FFFFFF",
        borderRadius: 16,
        padding: "20px",
        border: "1px solid #E5DFD5",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
      }}>
        <div style={{ marginBottom: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: "0 0 12px 0" }}>
            Текущие оценки
          </h4>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {renderScoreCard("Анализ ИИ", progress.aiScore, "#2D6A5C", "#E8F2EF")}
          {renderScoreCard("Оценка психолога", psychologistScore, "#1BAF7A", "#E6F7F2")}
          {renderScoreCard("Самооценка клиента", clientSelfScore, "#F59E0B", "#FEF3E2")}
        </div>

        {/* Discrepancy Warning */}
        {discrepancy !== null && discrepancy > 2 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              display: "flex",
              gap: 12,
              padding: "12px",
              background: "#FEF3E2",
              borderRadius: 8,
              border: "1px solid #F59E0B40",
            }}
          >
            <AlertCircle size={18} style={{ color: "#F59E0B", flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: "#92400E", lineHeight: "1.4" }}>
              <strong>Расхождение в оценках:</strong> Психолог и клиент по-разному видят прогресс. Это хороший повод для обсуждения на сессии.
            </div>
          </motion.div>
        )}
      </div>

      {/* Редактирование оценок */}
      <div style={{
        background: "#FFFFFF",
        borderRadius: 16,
        padding: "20px",
        border: "1px solid #E5DFD5",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
      }}>
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: "0 0 12px 0" }}>
            Оценка психолога
          </h4>
          <p style={{ fontSize: 12, color: "#6B6058", margin: 0 }}>
            Переопределите автоматическую оценку ИИ, если нужно
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1C1C1E", marginBottom: 8 }}>
              Шкала прогресса: {psychologistScore > 0 ? "+" : ""}{psychologistScore}
            </label>
            <input
              type="range"
              min="-5"
              max="5"
              value={psychologistScore}
              onChange={(e) => setPsychologistScore(parseInt(e.target.value))}
              style={{
                width: "100%",
                height: 6,
                borderRadius: 3,
                background: "linear-gradient(to right, #EF4444 0%, #F59E0B 50%, #1BAF7A 100%)",
                outline: "none",
                cursor: "pointer",
                appearance: "none",
              } as any}
            />
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              color: "#8C7355",
              marginTop: 8,
            }}>
              <span>-5 (сильное ухудшение)</span>
              <span>0 (нет изменений)</span>
              <span>+5 (значительный прогресс)</span>
            </div>
          </div>
        </div>

        {/* Самооценка клиента */}
        <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #E5DFD5" }}>
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: "0 0 12px 0" }}>
              Самооценка клиента
            </h4>
            <p style={{ fontSize: 12, color: "#6B6058", margin: 0 }}>
              Какую оценку дал клиент своему прогрессу?
            </p>
          </div>

          {!showClientInput && clientSelfScore === null ? (
            <button
              onClick={() => setShowClientInput(true)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#F5F3EF",
                border: "1px solid #E5DFD5",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: "#2D6A5C",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#E8F2EF"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#F5F3EF"}
            >
              Добавить самооценку клиента
            </button>
          ) : (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1C1C1E", marginBottom: 8 }}>
                  Оценка: {clientSelfScore !== null && clientSelfScore > 0 ? "+" : ""}{clientSelfScore}
                </label>
                <input
                  type="range"
                  min="-5"
                  max="5"
                  value={clientSelfScore ?? 0}
                  onChange={(e) => setClientSelfScore(parseInt(e.target.value))}
                  style={{
                    width: "100%",
                    height: 6,
                    borderRadius: 3,
                    background: "linear-gradient(to right, #EF4444 0%, #F59E0B 50%, #1BAF7A 100%)",
                    outline: "none",
                    cursor: "pointer",
                    appearance: "none",
                  } as any}
                />
              </div>
              {clientSelfScore !== null && (
                <button
                  onClick={() => setClientSelfScore(null)}
                  style={{
                    padding: "8px 12px",
                    background: "#F5F3EF",
                    border: "1px solid #E5DFD5",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "#6B6058",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#E5DFD5"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "#F5F3EF"}
                >
                  Очистить
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* График прогресса */}
      <div style={{
        background: "#FFFFFF",
        borderRadius: 16,
        padding: "20px",
        border: "1px solid #E5DFD5",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
      }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: "0 0 16px 0" }}>
          Динамика прогресса
        </h4>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5DFD5" />
            <XAxis dataKey="date" stroke="#8C7355" style={{ fontSize: 12 }} />
            <YAxis domain={[-5, 5]} stroke="#8C7355" style={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                background: "#FFFFFF",
                border: "1px solid #E5DFD5",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
              }}
              formatter={(value) => (typeof value === 'number' ? (value > 0 ? "+" + value : value.toString()) : value)}
              labelStyle={{ color: "#1C1C1E", fontSize: 12, fontWeight: 600 }}
            />
            <Line
              type="monotone"
              dataKey="ai"
              stroke="#2D6A5C"
              strokeWidth={2}
              name="ИИ анализ"
              dot={{ fill: "#2D6A5C", r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="psychologist"
              stroke="#1BAF7A"
              strokeWidth={2}
              name="Психолог"
              dot={{ fill: "#1BAF7A", r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="client"
              stroke="#F59E0B"
              strokeWidth={2}
              name="Клиент"
              dot={{ fill: "#F59E0B", r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>

        <div style={{
          display: "flex",
          gap: 24,
          marginTop: 16,
          paddingTop: 16,
          borderTop: "1px solid #E5DFD5",
          flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 12, background: "#2D6A5C", borderRadius: 2 }} />
            <span style={{ fontSize: 12, color: "#6B6058" }}>Анализ ИИ</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 12, background: "#1BAF7A", borderRadius: 2 }} />
            <span style={{ fontSize: 12, color: "#6B6058" }}>Оценка психолога</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 12, background: "#F59E0B", borderRadius: 2 }} />
            <span style={{ fontSize: 12, color: "#6B6058" }}>Самооценка клиента</span>
          </div>
        </div>
      </div>

      {/* История записей */}
      <div style={{
        background: "#FFFFFF",
        borderRadius: 16,
        padding: "20px",
        border: "1px solid #E5DFD5",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
      }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: "0 0 16px 0" }}>
          История оценок
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {progress.history.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr 1fr 1fr 1fr",
                gap: 12,
                padding: "12px",
                background: "#F5F3EF",
                borderRadius: 8,
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: "#1C1C1E" }}>{item.date}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#8C7355" }}>ИИ:</span>
                <span style={{ fontWeight: 600, color: "#2D6A5C" }}>
                  {item.aiScore > 0 ? "+" : ""}{item.aiScore}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#8C7355" }}>Психолог:</span>
                <span style={{ fontWeight: 600, color: "#1BAF7A" }}>
                  {(item.psychologistScore ?? item.aiScore) > 0 ? "+" : ""}{item.psychologistScore ?? item.aiScore}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#8C7355" }}>Клиент:</span>
                <span style={{ fontWeight: 600, color: item.clientScore ? "#F59E0B" : "#8C7355" }}>
                  {item.clientScore ? (item.clientScore > 0 ? "+" : "") + item.clientScore : "—"}
                </span>
              </div>
              {idx === progress.history.length - 1 && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  background: "#E6F7F2",
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#1BAF7A",
                }}>
                  <span>Последняя</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
