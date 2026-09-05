"use client";
import { use, useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Send, ChevronLeft, FileText, Download,
  TrendingUp, TrendingDown, Minus, ArrowRight, Video, Clock,
  Sparkles, X, Link2, Copy, Check,
} from "lucide-react";
import { demoClientExtrasByName } from "@/lib/demo-client-extras";
import { APPROACH_LABELS, type Approach } from "@/lib/approaches";
import { TEST_SCALES, type TestType } from "@/lib/testScales";
import { useSession } from "@/lib/SessionContext";
import { useClients } from "@/lib/ClientsContext";
import { Button, Card, CardContent } from "@/components/ui";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const EMPTY_TRIGGERS: string[] = [];
const EMPTY_PROGRESS = { aiScore: 0, psychologistScore: null, clientScore: null, history: [] as Array<{ date: string; aiScore: number; psychologistScore?: number; clientScore?: number }> };

const avatarColors = ["#2D6A5C", "#1BAF7A", "#F59E0B", "#EF4444", "#8B5CF6"];

interface ChatMessage {
  id: string;
  role: "client" | "psychologist";
  text: string;
  time: string;
  file?: { name: string; size: string };
  status?: "pending" | "sent" | "delivered" | "failed";
  errorMessage?: string | null;
}

interface MessengerLink {
  platform: "telegram" | "vk";
  external_username: string | null;
  linked_at: string;
}

interface TestResult {
  id: string;
  test_type: TestType;
  score: number;
  max_score: number;
  interpretation: string | null;
  status: "pending" | "completed";
  created_at: string;
}

// Приводит запись из таблицы messages (API-формат) к формату чата на экране.
function toChatMessage(raw: {
  id: string; direction: string; text: string; created_at: string;
  status: string; error_message: string | null;
}): ChatMessage {
  const time = new Date(raw.created_at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  return {
    id: raw.id,
    role: raw.direction === "incoming" ? "client" : "psychologist",
    text: raw.text,
    time,
    status: raw.status as ChatMessage["status"],
    errorMessage: raw.error_message,
  };
}

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
  const { clients, loading: clientsLoading } = useClients();
  const client = clients.find(c => c.id === id);
  const { sessions, addSession } = useSession();
  const router = useRouter();
  const [startingSession, setStartingSession] = useState(false);

  // "Начать сессию" на карточке клиента — спонтанный звонок вне
  // расписания (в отличие от запланированной сессии из /sessions).
  // Создаём запись sessions "на сейчас" (тот же паттерн, что и
  // startSessionNow в Sidebar), затем переходим на /session/{id}
  // с реальным session_id — раньше ссылка вела на /session/{clientId},
  // и страница звонка не могла достать конкретную сессию из БД.
  async function startSessionNow() {
    if (!client || startingSession) return;
    setStartingSession(true);
    try {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const created = await addSession({ clientId: client.id, clientName: client.name, date: dateStr, time: timeStr });
      router.push(`/session/${created.id}`);
    } finally {
      setStartingSession(false);
    }
  }

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messengerLinks, setMessengerLinks] = useState<MessengerLink[]>([]);
  const [sendChannel, setSendChannel] = useState<"telegram" | "vk">("telegram");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("sessions");
  const [exportingTranscripts, setExportingTranscripts] = useState(false);
  const [showPeriodSummary, setShowPeriodSummary] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [periodSummaryResult, setPeriodSummaryResult] = useState<string | null>(null);
  const [periodSummaryError, setPeriodSummaryError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testsLoading, setTestsLoading] = useState(true);
  const [showSendTestForm, setShowSendTestForm] = useState(false);
  const [newTestType, setNewTestType] = useState<TestType>("GAD7");
  const [newTestScore, setNewTestScore] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    async function loadMessages() {
      setMessagesLoading(true);
      try {
        const res = await fetch(`/api/messages?client_id=${id}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setMessages((data.messages ?? []).map(toChatMessage));
          setMessengerLinks(data.links ?? []);
          if ((data.links ?? []).some((l: MessengerLink) => l.platform === "vk")) setSendChannel("vk");
        }
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }
    loadMessages();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function loadTests() {
      setTestsLoading(true);
      try {
        const res = await fetch(`/api/clients/${id}/tests`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setTestResults(data.tests ?? []);
        }
      } finally {
        if (!cancelled) setTestsLoading(false);
      }
    }
    loadTests();
    return () => { cancelled = true; };
  }, [id]);

  const handleAddTestResult = async () => {
    const score = Number(newTestScore);
    if (Number.isNaN(score) || score < 0) return;
    setSendingTest(true);
    try {
      const res = await fetch("/api/tests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: id, test_type: newTestType, score }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResults(prev => [...prev, data.test]);
        setNewTestScore("");
        setShowSendTestForm(false);
      } else {
        alert(data.error ?? "Не удалось сохранить результат теста");
      }
    } catch {
      alert("Не удалось связаться с сервером");
    } finally {
      setSendingTest(false);
    }
  };

  const clientSessions = useMemo(
    () => sessions.filter(s => s.clientId === id).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    [sessions, id]
  );
  const today = "2026-08-16";
  const upcomingSessions = clientSessions.filter(s => s.date >= today);
  const pastSessions = clientSessions.filter(s => s.date < today).reverse();

  const progress = client?.progress ?? EMPTY_PROGRESS;
  // Реальная история теста — из test_results (Supabase). Пока психолог
  // ничего не внёс — используем demo-extras как наглядную заглушку
  // (только для показа UI, не смешивается с реальными данными после
  // первого сохранённого результата).
  const demoExtrasForTrend = demoClientExtrasByName[client?.name ?? ""];
  const completedTests = useMemo(() => testResults.filter(t => t.status === "completed"), [testResults]);
  const clientTestHistoryForTrend = completedTests.length > 0
    ? completedTests.map(t => ({ date: new Date(t.created_at).toLocaleDateString("ru", { day: "numeric", month: "short" }), score: t.score }))
    : demoExtrasForTrend?.testHistory ?? [];
  // Тренд считаем по истории теста (score ниже = лучше для GAD-7/PHQ-9/MBI,
  // поэтому направление здесь условное — просто "снизился/вырос за 2 замера").
  // Пока в БД нет флага "меньше = лучше" по методике, это грубое приближение
  // для демонстрации, не клиническая оценка.
  const trend = useMemo(() => {
    if (clientTestHistoryForTrend.length >= 2) {
      const recent = clientTestHistoryForTrend.slice(-2);
      if (recent[1].score < recent[0].score) return "improving";
      if (recent[1].score > recent[0].score) return "degrading";
      return "stable";
    }
    if (progress.history.length < 2) return "stable";
    const recent = progress.history.slice(-2);
    if (recent[1].aiScore > recent[0].aiScore) return "improving";
    if (recent[1].aiScore < recent[0].aiScore) return "degrading";
    return "stable";
  }, [progress, clientTestHistoryForTrend]);
  const trendColor = trend === "improving" ? "#1BAF7A" : trend === "degrading" ? "#EF4444" : "#F59E0B";
  const TrendIcon = trend === "improving" ? TrendingUp : trend === "degrading" ? TrendingDown : Minus;

  const sendMessage = async () => {
    if (!chatInput.trim() || sending) return;
    // Вложения пока не поддерживаются реальной отправкой — Telegram/VK
    // API для файлов требует отдельной загрузки, добавим отдельно.
    const text = chatInput;
    setChatInput("");
    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: id, text, channel: sendChannel }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages(prev => [...prev, toChatMessage(data.message)]);
        setSelectedFile(null);
      } else {
        setChatInput(text);
        alert(data.error ?? "Не удалось отправить сообщение");
      }
    } catch {
      setChatInput(text);
      alert("Не удалось связаться с сервером");
    } finally {
      setSending(false);
    }
  };

  const loadInviteLink = async () => {
    setInviteError(null);
    setInviteUrl(null);
    try {
      const res = await fetch(`/api/clients/${id}/messenger-link?platform=telegram`);
      const data = await res.json();
      if (data.linked) return; // уже привязан, баннер и так не покажется
      if (data.invite_url) setInviteUrl(data.invite_url);
      else setInviteError(data.error ?? "Не удалось получить ссылку-приглашение");
    } catch {
      setInviteError("Не удалось связаться с сервером");
    }
  };

  const copyInviteLink = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  if (clientsLoading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ color: "#8C7355" }}>Загрузка…</p>
      </div>
    );
  }

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
  // triggers/ДЗ пока остаются демо-заглушкой (см. lib/demo-client-extras.ts) —
  // тесты и прогресс теперь реальные (test_results в Supabase, см. выше).
  const demoExtras = demoClientExtrasByName[client.name];
  const clientTestHistory = clientTestHistoryForTrend;
  const triggers = client.triggers ?? demoExtras?.triggers ?? EMPTY_TRIGGERS;
  const latestCompletedTest = completedTests.length > 0 ? completedTests[completedTests.length - 1] : null;
  const lastTest = latestCompletedTest
    ? {
        name: TEST_SCALES[latestCompletedTest.test_type].label,
        score: latestCompletedTest.score,
        maxScore: latestCompletedTest.max_score,
        date: new Date(latestCompletedTest.created_at).toLocaleDateString("ru", { day: "numeric", month: "short" }),
      }
    : client.lastTest ?? demoExtras?.lastTest;
  const hwTotal = client.hwTotal || demoExtras?.hwTotal || 0;
  const hwCompleted = client.hwCompleted || demoExtras?.hwCompleted || 0;
  const hwPct = hwTotal > 0 ? Math.round((hwCompleted / hwTotal) * 100) : 0;

  const handleExportAllTranscripts = async () => {
    setExportingTranscripts(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/export/transcripts`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Не удалось выгрузить транскрипты");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "transcripts.txt";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Не удалось выгрузить транскрипты — проверьте соединение");
    } finally {
      setExportingTranscripts(false);
    }
  };

  const toggleSessionSelected = (sessionId: string) => {
    setSelectedSessionIds(prev =>
      prev.includes(sessionId) ? prev.filter(id => id !== sessionId) : [...prev, sessionId]
    );
  };

  const handleGenerateSummary = async () => {
    if (selectedSessionIds.length === 0) {
      setPeriodSummaryError("Выберите хотя бы одну сессию");
      return;
    }
    setGeneratingSummary(true);
    setPeriodSummaryError(null);
    setPeriodSummaryResult(null);
    try {
      const res = await fetch(`/api/clients/${client.id}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_ids: selectedSessionIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPeriodSummaryError(data.error ?? "Не удалось сгенерировать срез");
        return;
      }
      setPeriodSummaryResult(data.summary);
    } catch {
      setPeriodSummaryError("Не удалось связаться с сервером — проверьте соединение");
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleDownloadSummary = () => {
    if (!periodSummaryResult) return;
    const blob = new Blob([periodSummaryResult], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `srez_${client.name.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const closePeriodSummaryModal = () => {
    setShowPeriodSummary(false);
    setSelectedSessionIds([]);
    setPeriodSummaryResult(null);
    setPeriodSummaryError(null);
  };

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
        <Button size="md" onClick={startSessionNow} disabled={startingSession}>
          {startingSession ? "Создаю сессию..." : <>Начать сессию <ArrowRight size={15} style={{ marginLeft: 8 }} /></>}
        </Button>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={handleExportAllTranscripts}
                disabled={exportingTranscripts}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "8px 12px", background: "#F5F3EF", border: "1px solid #E5DFD5",
                  borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#1C1C1E",
                  cursor: exportingTranscripts ? "not-allowed" : "pointer", fontFamily: "var(--font-sans)",
                }}
              >
                <Download size={13} /> {exportingTranscripts ? "Готовлю..." : "Выгрузить все транскрипты"}
              </button>
              <button
                onClick={() => setShowPeriodSummary(true)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "8px 12px", background: "#E8F2EF", border: "1px solid #2D6A5C40",
                  borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#2D6A5C",
                  cursor: "pointer", fontFamily: "var(--font-sans)",
                }}
              >
                <Sparkles size={13} /> Срез за период
              </button>
            </div>
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
                      <Link href={`/session/${s.id}`} style={{ textDecoration: "none" }}>
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
                {/* Баннер привязки мессенджера — показываем, пока у клиента нет ни одной привязки */}
                {!messagesLoading && messengerLinks.length === 0 && (
                  <div style={{
                    padding: "10px 12px", background: "#FEF3C7", borderRadius: 8,
                    marginBottom: 10, fontSize: 12, color: "#92400E",
                  }}>
                    {inviteUrl ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Link2 size={13} style={{ flexShrink: 0 }} />
                        <span style={{ wordBreak: "break-all" }}>{inviteUrl}</span>
                        <button
                          onClick={copyInviteLink}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#92400E", display: "flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 600 }}
                        >
                          {inviteCopied ? <Check size={12} /> : <Copy size={12} />} {inviteCopied ? "Скопировано" : "Скопировать"}
                        </button>
                      </div>
                    ) : inviteError ? (
                      <span>{inviteError}</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span>Чат клиента не подключён — сообщения сохранятся, но не дойдут, пока клиент не подключит мессенджер.</span>
                        <button onClick={loadInviteLink} style={{ background: "none", border: "none", cursor: "pointer", color: "#92400E", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
                          Получить ссылку →
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
                  {messagesLoading && (
                    <p style={{ fontSize: 12, color: "#8C7355", textAlign: "center", marginTop: 20 }}>Загрузка переписки…</p>
                  )}
                  {!messagesLoading && messages.length === 0 && (
                    <p style={{ fontSize: 12, color: "#8C7355", textAlign: "center", marginTop: 20 }}>Переписки пока нет</p>
                  )}
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
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 10, opacity: 0.6 }}>{msg.time}</span>
                          {msg.role === "psychologist" && msg.status === "pending" && (
                            <span style={{ fontSize: 10, opacity: 0.75 }} title={msg.errorMessage ?? "Клиент ещё не подключил чат"}>· не доставлено</span>
                          )}
                          {msg.role === "psychologist" && msg.status === "failed" && (
                            <span style={{ fontSize: 10, color: "#FCA5A5" }} title={msg.errorMessage ?? ""}>· ошибка отправки</span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {messengerLinks.length > 1 && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {messengerLinks.map(l => (
                      <button
                        key={l.platform}
                        onClick={() => setSendChannel(l.platform)}
                        style={{
                          padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                          border: sendChannel === l.platform ? "1px solid #2D6A5C" : "1px solid #E5DFD5",
                          background: sendChannel === l.platform ? "#E8F2EF" : "#fff",
                          color: sendChannel === l.platform ? "#2D6A5C" : "#6B6058",
                          cursor: "pointer",
                        }}
                      >
                        {l.platform === "telegram" ? "Telegram" : "ВКонтакте"}
                      </button>
                    ))}
                  </div>
                )}

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
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={sendMessage}
                      disabled={sending || !chatInput.trim()}
                      style={{
                        width: 32, height: 32, background: sending || !chatInput.trim() ? "#A7C4BC" : "#2D6A5C",
                        border: "none", borderRadius: 6,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: sending || !chatInput.trim() ? "default" : "pointer", color: "#FFFFFF",
                      }}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
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
                  <div style={{ fontSize: 13, color: "#1C1C1E" }}>{APPROACH_LABELS[client.approach as Approach] ?? client.approach}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 4 }}>Всего сессий</div>
                  <div style={{ fontSize: 13, color: "#1C1C1E" }}>{clientSessions.length}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 4 }}>Триггеры</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {triggers.length === 0 && (
                      <span style={{ fontSize: 12, color: "#8C7355" }}>Пока не отмечены</span>
                    )}
                    {triggers.map((trigger, i) => (
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
                Домашние задания ({hwCompleted}/{hwTotal})
              </h3>
              <div style={{ height: 8, background: "rgba(79,126,255,0.1)", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                <div style={{
                  width: `${hwPct}%`,
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>
                  Динамика теста {lastTest?.name ?? "—"}
                </h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", background: `${trendColor}20`, borderRadius: 20,
                  }}>
                    <TrendIcon size={14} style={{ color: trendColor }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: trendColor }}>
                      {trend === "improving" ? "Улучшение" : trend === "degrading" ? "Ухудшение" : "Стабильно"}
                    </span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setShowSendTestForm(v => !v)}>
                    + Внести результат теста
                  </Button>
                </div>
              </div>

              {showSendTestForm && (
                <div style={{
                  display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
                  padding: 12, background: "#F5F3EF", borderRadius: 8, marginBottom: 16,
                }}>
                  <select
                    value={newTestType}
                    onChange={e => setNewTestType(e.target.value as TestType)}
                    style={{
                      padding: "8px 10px", border: "1px solid #E5DFD5", borderRadius: 6,
                      fontSize: 12.5, color: "#1C1C1E", background: "#FFFFFF",
                    }}
                  >
                    {Object.entries(TEST_SCALES).map(([key, scale]) => (
                      <option key={key} value={key}>{scale.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={TEST_SCALES[newTestType].maxScore}
                    value={newTestScore}
                    onChange={e => setNewTestScore(e.target.value)}
                    placeholder={`Балл (0–${TEST_SCALES[newTestType].maxScore})`}
                    style={{
                      width: 140, padding: "8px 10px", border: "1px solid #E5DFD5", borderRadius: 6,
                      fontSize: 12.5, color: "#1C1C1E", background: "#FFFFFF",
                    }}
                  />
                  <Button size="sm" onClick={handleAddTestResult} disabled={sendingTest || !newTestScore}>
                    {sendingTest ? "Сохранение…" : "Сохранить"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowSendTestForm(false)}>
                    Отмена
                  </Button>
                </div>
              )}

              {testsLoading ? (
                <p style={{ fontSize: 12, color: "#8C7355" }}>Загрузка истории тестов…</p>
              ) : clientTestHistory.length > 0 ? (
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
                  {lastTest
                    ? `Последний результат: ${lastTest.name} ${lastTest.score}/${lastTest.maxScore} (${lastTest.date})`
                    : "Тесты ещё не проводились"}
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
                <LineChart data={progress.history}>
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

      {/* Модалка "Срез за период" */}
      {showPeriodSummary && (
        <>
          <div
            onClick={() => !generatingSummary && closePeriodSummaryModal()}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 70 }}
          />
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 75,
          }}>
            <div style={{
              background: "#FFFFFF", borderRadius: 16, width: "90%", maxWidth: 560,
              maxHeight: "85vh", overflowY: "auto", boxShadow: "0 25px 80px rgba(0,0,0,0.2)",
            }}>
              <div style={{
                padding: "18px 22px", borderBottom: "1px solid #E5DFD5",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                  Срез за период
                </h2>
                <button
                  onClick={() => !generatingSummary && closePeriodSummaryModal()}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355" }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                {!periodSummaryResult && (
                  <>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                        Выберите сессии
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                        {clientSessions.length === 0 && (
                          <p style={{ fontSize: 12, color: "#8C7355" }}>У этого клиента пока нет сессий</p>
                        )}
                        {clientSessions.map(s => (
                          <label
                            key={s.id}
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "8px 10px", background: "#F5F3EF", borderRadius: 8,
                              fontSize: 13, color: "#1C1C1E", cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedSessionIds.includes(s.id)}
                              onChange={() => toggleSessionSelected(s.id)}
                              style={{ accentColor: "#2D6A5C" }}
                            />
                            {s.date} · {s.time}
                          </label>
                        ))}
                      </div>
                    </div>

                    {periodSummaryError && (
                      <p style={{ fontSize: 12.5, color: "#EF4444", background: "#FEE2E2", borderRadius: 8, padding: "8px 12px", margin: 0 }}>
                        {periodSummaryError}
                      </p>
                    )}

                    <p style={{ fontSize: 11, color: "#8C7355", margin: 0, fontStyle: "italic" }}>
                      Тяжёлый запрос — стоит 3 из лимита
                    </p>

                    <Button onClick={handleGenerateSummary} variant="primary" disabled={generatingSummary}>
                      {generatingSummary ? "Генерирую..." : "Сгенерировать"}
                    </Button>
                  </>
                )}

                {periodSummaryResult && (
                  <>
                    <div style={{
                      whiteSpace: "pre-wrap", fontSize: 13, color: "#1C1C1E",
                      lineHeight: 1.5, background: "#F5F3EF", borderRadius: 8, padding: 14,
                    }}>
                      {periodSummaryResult}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button onClick={handleDownloadSummary} variant="secondary">
                        <Download size={14} style={{ marginRight: 6 }} /> Скачать
                      </Button>
                      <Button onClick={closePeriodSummaryModal} variant="secondary">
                        Закрыть
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
