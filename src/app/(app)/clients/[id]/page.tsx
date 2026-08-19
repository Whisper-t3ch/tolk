"use client";
import { use, useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Send, Paperclip, ChevronLeft, FileText, Download,
  TrendingUp, TrendingDown, Minus, ArrowRight, Video, Clock,
} from "lucide-react";
import { clients, testHistory as testHistoryByClient } from "@/lib/mock-data";
import { useSession } from "@/lib/SessionContext";
import { Button, Card, CardContent } from "@/components/ui";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const avatarColors = ["#2D6A5C", "#1BAF7A", "#F59E0B", "#EF4444", "#8B5CF6"];

interface ChatMessage {
  id: string;
  role: "client" | "psychologist";
  text: string;
  time: string;
  file?: { name: string; size: string };
}

const MOCK_MESSAGES: ChatMessage[] = [
  { id: "1", role: "client", text: "Привет! Как дела?", time: "14:32" },
  { id: "2", role: "psychologist", text: "Привет! Всё хорошо, спасибо. Как у тебя?", time: "14:34" },
  { id: "3", role: "client", text: "Мне нужна консультация по поводу работы", time: "14:35" },
];

const MOCK_FILES = [
  { name: "Дневник_ситуаций_неделя_6.pdf", size: "214 KB", date: "12 авг", uploadedBy: "client" as const },
  { name: "GAD-7_результаты.pdf", size: "88 KB", date: "12 авг", uploadedBy: "psychologist" as const },
  { name: "Протокол_сессии_7.docx", size: "45 KB", date: "5 авг", uploadedBy: "psychologist" as const },
];

const TABS = [
  { id: "sessions", label: "Сессии" },
  { id: "summary", label: "Сводка" },
  { id: "analytics", label: "Аналитика" },
  { id: "files", label: "Файлы" },
] as const;

type TabId = typeof TABS[number]["id"];

export default function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const client = clients.find(c => c.id === id);
  const { sessions } = useSession();

  const [messages, setMessages] = useState<ChatMessage[]>(MOCK_MESSAGES);
  const [chatInput, setChatInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("sessions");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const clientSessions = useMemo(
    () => sessions.filter(s => s.clientId === id).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    [sessions, id]
  );
  const today = "2026-08-16";
  const upcomingSessions = clientSessions.filter(s => s.date >= today);
  const pastSessions = clientSessions.filter(s => s.date < today).reverse();

  const sendMessage = () => {
    if (!chatInput.trim() && !selectedFile) return;

    const now = new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "psychologist",
      text: chatInput,
      time: now,
      file: selectedFile ? {
        name: selectedFile.name,
        size: (selectedFile.size / 1024).toFixed(1) + " KB",
      } : undefined,
    };

    setMessages(prev => [...prev, newMessage]);
    setChatInput("");
    setSelectedFile(null);
  };

  if (!client) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ color: "#8C7355" }}>Клиент не найден</p>
        <Link href="/clients" style={{ color: "#2D6A5C", fontSize: 13, fontWeight: 600 }}>← Все клиенты</Link>
      </div>
    );
  }

  const clientIdx = clients.indexOf(client);
  const avatarColor = avatarColors[clientIdx % avatarColors.length];
  const clientTestHistory = testHistoryByClient[client.id] ?? [];

  const trend = useMemo(() => {
    if (client.progress.history.length < 2) return "stable";
    const recent = client.progress.history.slice(-2);
    if (recent[1].aiScore > recent[0].aiScore) return "improving";
    if (recent[1].aiScore < recent[0].aiScore) return "degrading";
    return "stable";
  }, [client]);
  const trendColor = trend === "improving" ? "#1BAF7A" : trend === "degrading" ? "#EF4444" : "#F59E0B";
  const TrendIcon = trend === "improving" ? TrendingUp : trend === "degrading" ? TrendingDown : Minus;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", width: "100%" }}>
      {/* Кнопка назад + профиль-хедер */}
      <Link href="/clients" style={{ textDecoration: "none" }}>
        <button style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px", background: "#F5F3EF",
          border: "1px solid #E5DFD5", borderRadius: 6,
          fontSize: 12, fontWeight: 600, color: "#1C1C1E",
          cursor: "pointer", marginBottom: 16,
        }}>
          <ChevronLeft size={14} /> Все клиенты
        </button>
      </Link>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#FFFFFF", border: "1px solid #E5DFD5", borderRadius: 12,
        padding: "20px 24px", marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 56, height: 56, background: avatarColor, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 700, color: "#fff",
          }}>
            {client.initials}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E" }}>{client.name}</div>
            <div style={{ fontSize: 13, color: "#6B6058", marginTop: 2 }}>
              {client.age} лет · {client.request}
            </div>
          </div>
          <div style={{
            padding: "4px 10px",
            background: client.status === "active" ? "#E6F7F2" : client.status === "pause" ? "#FEF3C7" : "#F5F3EF",
            color: client.status === "active" ? "#1BAF7A" : client.status === "pause" ? "#F59E0B" : "#8C7355",
            borderRadius: 6, fontSize: 11, fontWeight: 700,
          }}>
            {client.status === "active" ? "Активный" : client.status === "pause" ? "На паузе" : "Завершено"}
          </div>
        </div>
        <Link href={`/session/${client.id}`} style={{ textDecoration: "none" }}>
          <Button size="md">
            Начать сессию <ArrowRight size={15} style={{ marginLeft: 8 }} />
          </Button>
        </Link>
      </div>

      {/* Табы */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid #E5DFD5" }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "10px 18px",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #2D6A5C" : "2px solid transparent",
              fontSize: 13,
              fontWeight: 600,
              color: activeTab === tab.id ? "#2D6A5C" : "#6B6058",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* СЕССИИ: список сессий клиента + чат */}
      {activeTab === "sessions" && (
        <div style={{ display: "flex", gap: 16, height: "calc(100vh - 340px)", minHeight: 480 }}>
          <div style={{ flex: "0 0 34%", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: "#8C7355", textTransform: "uppercase", marginBottom: 10 }}>
                Предстоящие ({upcomingSessions.length})
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {upcomingSessions.length === 0 && (
                  <p style={{ fontSize: 12, color: "#8C7355" }}>Нет запланированных сессий</p>
                )}
                {upcomingSessions.map(s => (
                  <Card key={s.id}>
                    <CardContent className="pt-3 pb-3" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Clock size={13} style={{ color: "#2D6A5C" }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#1C1C1E" }}>{s.date} · {s.time}</span>
                      </div>
                      <Link href={`/session/${client.id}`} style={{ textDecoration: "none" }}>
                        <Button size="sm">Начать</Button>
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: "#8C7355", textTransform: "uppercase", marginBottom: 10 }}>
                Прошедшие ({pastSessions.length})
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pastSessions.length === 0 && (
                  <p style={{ fontSize: 12, color: "#8C7355" }}>Пока нет прошедших сессий</p>
                )}
                {pastSessions.map(s => (
                  <Card key={s.id}>
                    <CardContent className="pt-3 pb-3" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Video size={13} style={{ color: "#8C7355" }} />
                      <span style={{ fontSize: 12, color: "#6B6058" }}>{s.date} · {s.time}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>

          {/* Чат с клиентом */}
          <div style={{ flex: "0 0 66%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Card style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <CardContent className="pt-4 flex-1 flex flex-col" style={{ minHeight: 0 }}>
                <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        display: "flex",
                        justifyContent: msg.role === "psychologist" ? "flex-end" : "flex-start",
                        marginBottom: 8,
                      }}
                    >
                      <div style={{
                        maxWidth: "80%", padding: "8px 12px", borderRadius: 8,
                        background: msg.role === "psychologist" ? "#2D6A5C" : "#F5F3EF",
                        color: msg.role === "psychologist" ? "#fff" : "#1C1C1E",
                        fontSize: 12,
                      }}>
                        <p style={{ margin: 0 }}>{msg.text}</p>
                        {msg.file && (
                          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
                            📎 {msg.file.name} ({msg.file.size})
                          </div>
                        )}
                        <span style={{ fontSize: 10, opacity: 0.6, marginTop: 4, display: "block" }}>
                          {msg.time}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <textarea
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyPress={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder="Напишите сообщение..."
                      style={{
                        width: "100%", padding: "8px 12px",
                        border: "1px solid #E5DFD5", borderRadius: 6,
                        fontSize: 12, fontFamily: "var(--font-sans)",
                        color: "#1C1C1E", resize: "none", maxHeight: 80,
                        boxSizing: "border-box",
                      }}
                      rows={2}
                    />
                    {selectedFile && (
                      <div style={{ fontSize: 11, color: "#2D6A5C", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        📎 {selectedFile.name}
                        <button onClick={() => setSelectedFile(null)} style={{ background: "none", border: "none", color: "#8C7355", cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: 32, height: 32, background: "#F5F3EF",
                        border: "1px solid #E5DFD5", borderRadius: 6,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", color: "#6B6058",
                      }}
                      title="Добавить файл"
                    >
                      <Paperclip size={16} />
                    </button>
                    <button
                      onClick={sendMessage}
                      style={{
                        width: 32, height: 32, background: "#2D6A5C",
                        border: "none", borderRadius: 6,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", color: "#FFFFFF",
                      }}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={e => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }}
                  style={{ display: "none" }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* СВОДКА: профиль + ДЗ */}
      {activeTab === "summary" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card>
            <CardContent className="pt-6">
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 16 }}>Профиль</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 4 }}>Пол</div>
                  <div style={{ fontSize: 13, color: "#1C1C1E" }}>{client.gender === "female" ? "Женский" : "Мужской"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 4 }}>Запрос</div>
                  <div style={{ fontSize: 13, color: "#1C1C1E" }}>{client.request}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 4 }}>Подход</div>
                  <div style={{ fontSize: 13, color: "#1C1C1E" }}>{client.approach}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 4 }}>Всего сессий</div>
                  <div style={{ fontSize: 13, color: "#1C1C1E" }}>{client.sessions}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 4 }}>Триггеры</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {client.triggers.map((trigger, i) => (
                      <span key={i} style={{ padding: "4px 8px", background: "#E8F2EF", color: "#2D6A5C", borderRadius: 4, fontSize: 11 }}>
                        {trigger}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 16 }}>
                Домашние задания ({client.hwCompleted}/{client.hwTotal})
              </h3>
              <div style={{ height: 8, background: "rgba(79,126,255,0.1)", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                <div style={{
                  width: `${Math.round((client.hwCompleted / client.hwTotal) * 100)}%`,
                  height: "100%", background: "#2D6A5C", borderRadius: 4,
                }} />
              </div>
              <p style={{ fontSize: 12, color: "#8C7355" }}>
                Подробный список заданий и их статус синхронизируются из Telegram-бота клиента.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* АНАЛИТИКА: тесты + прогресс */}
      {activeTab === "analytics" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardContent className="pt-6">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>
                  Динамика теста {client.lastTest.name}
                </h3>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 10px", background: `${trendColor}20`, borderRadius: 20,
                }}>
                  <TrendIcon size={14} style={{ color: trendColor }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: trendColor }}>
                    {trend === "improving" ? "Улучшение" : trend === "degrading" ? "Ухудшение" : "Стабильно"}
                  </span>
                </div>
              </div>
              {clientTestHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={clientTestHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5DFD5" />
                    <XAxis dataKey="date" stroke="#8C7355" style={{ fontSize: 11 }} />
                    <YAxis stroke="#8C7355" style={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5DFD5" }} />
                    <Line type="monotone" dataKey="score" stroke="#2D6A5C" strokeWidth={2} dot={{ fill: "#2D6A5C", r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ fontSize: 12, color: "#8C7355" }}>Пока недостаточно данных теста для графика</p>
              )}
              <div style={{ marginTop: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>
                  Последний результат: {client.lastTest.name} {client.lastTest.score}/{client.lastTest.maxScore} ({client.lastTest.date})
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 16 }}>
                Оценка прогресса (ИИ / психолог / клиент)
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={client.progress.history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5DFD5" />
                  <XAxis dataKey="date" stroke="#8C7355" style={{ fontSize: 11 }} />
                  <YAxis domain={[-5, 5]} stroke="#8C7355" style={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5DFD5" }} />
                  <Line type="monotone" dataKey="aiScore" name="ИИ" stroke="#2D6A5C" strokeWidth={2} dot={{ fill: "#2D6A5C", r: 3 }} />
                  <Line type="monotone" dataKey="psychologistScore" name="Психолог" stroke="#1BAF7A" strokeWidth={2} dot={{ fill: "#1BAF7A", r: 3 }} />
                  <Line type="monotone" dataKey="clientScore" name="Клиент" stroke="#F59E0B" strokeWidth={2} dot={{ fill: "#F59E0B", r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ФАЙЛЫ */}
      {activeTab === "files" && (
        <Card>
          <CardContent className="pt-6">
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 16 }}>
              Файлы клиента
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {MOCK_FILES.map((f, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", background: "#F5F3EF", borderRadius: 8,
                }}>
                  <FileText size={18} style={{ color: "#2D6A5C", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#8C7355" }}>
                      {f.size} · {f.date} · {f.uploadedBy === "client" ? "от клиента" : "от вас"}
                    </div>
                  </div>
                  <button style={{
                    width: 32, height: 32, background: "#FFFFFF",
                    border: "1px solid #E5DFD5", borderRadius: 6,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "#6B6058", flexShrink: 0,
                  }} title="Скачать">
                    <Download size={14} />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
