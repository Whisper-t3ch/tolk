"use client";
import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Send, Paperclip, User, FileText, X, Mic, Trash2, Play, Pause, Smile, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useClients } from "@/lib/ClientsContext";
import { createClientRecord } from "@/lib/data/clients";
import { Card, CardContent, Input } from "@/components/ui";
import ClientProgressScale from "@/components/ClientProgressScale";

// Триггеры/тесты/история прогресса пока не мигрированы на Supabase (Этап 2
// осознанно ограничен клиентами и сессиями) — для реальных клиентов
// показываем пустые заглушки вместо padения интерфейса.
const EMPTY_TRIGGERS: string[] = [];
const EMPTY_PROGRESS = { aiScore: 0, psychologistScore: null, clientScore: null, history: [] as Array<{ date: string; aiScore: number; psychologistScore?: number; clientScore?: number }> };

const avatarColors = ["#2D6A5C", "#1BAF7A", "#F59E0B", "#EF4444", "#8B5CF6"];

const formatMessageTime = (date: Date): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const timeStr = date.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });

  if (messageDate.getTime() === today.getTime()) {
    return `Сегодня ${timeStr}`;
  } else if (messageDate.getTime() === yesterday.getTime()) {
    return `Вчера ${timeStr}`;
  } else {
    return date.toLocaleDateString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
};

const getClientStatus = (): { online: boolean; lastSeen: string } => {
  // Симуляция статуса клиента
  const isOnline = Math.random() > 0.6;
  const lastSeenMinutes = Math.floor(Math.random() * 120) + 5;
  const lastSeen = lastSeenMinutes < 60
    ? `${lastSeenMinutes} мин назад`
    : `${Math.floor(lastSeenMinutes / 60)} ч назад`;

  return { online: isOnline, lastSeen };
};

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "🙏"];

interface ChatMessage {
  id: string;
  role: "client" | "psychologist";
  text: string;
  time: string;
  timestamp: Date;
  isRead?: boolean;
  file?: { name: string; size: string };
  voice?: { duration: string };
  reactions?: string[];
}

const createMockMessages = (): ChatMessage[] => {
  const now = new Date();
  const messages: ChatMessage[] = [
    { id: "1", role: "client", text: "Привет! Как дела?", time: "14:32", timestamp: new Date(now.getTime() - 5 * 60000), isRead: true },
    { id: "2", role: "psychologist", text: "Привет! Всё хорошо, спасибо. Как у тебя?", time: "14:34", timestamp: new Date(now.getTime() - 4 * 60000), isRead: true },
    { id: "3", role: "client", text: "Мне нужна консультация по поводу работы", time: "14:35", timestamp: new Date(now.getTime() - 3 * 60000), isRead: true },
    { id: "4", role: "psychologist", text: "Давай подробнее о том, что тебя беспокоит?", time: "14:37", timestamp: new Date(now.getTime() - 2 * 60000), isRead: true },
    { id: "5", role: "client", text: "В последнее время чувствую усталость и стресс на работе", time: "14:38", timestamp: new Date(now.getTime() - 1 * 60000), isRead: true },
  ];
  return messages;
};

function ClientsPageInner() {
  const { clients, loading: clientsLoading, refresh: refreshClients } = useClients();
  const searchParams = useSearchParams();
  const clientFromUrl = searchParams.get("client");
  const filterFromUrl = searchParams.get("filter"); // "new" | "attention" | null

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [specialFilter, setSpecialFilter] = useState<string | null>(filterFromUrl);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(clientFromUrl || null);
  const [messages, setMessages] = useState<ChatMessage[]>(createMockMessages());
  const [chatInput, setChatInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileTab, setProfileTab] = useState<"profile" | "progress">("profile");
  const [clientStatus, setClientStatus] = useState({ online: true, lastSeen: "сейчас" });
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [reactionMenuFor, setReactionMenuFor] = useState<string | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientRequest, setNewClientRequest] = useState("");
  const [newClientApproach, setNewClientApproach] = useState("");
  const [newClientAge, setNewClientAge] = useState("");
  const [newClientGender, setNewClientGender] = useState<"male" | "female">("female");
  const [creatingClient, setCreatingClient] = useState(false);
  const [createClientError, setCreateClientError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Инициализируем статус только на клиенте
    setClientStatus(getClientStatus());
    // Обновляем статус каждые 30 секунд
    const interval = setInterval(() => {
      setClientStatus(getClientStatus());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const selectedClient = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;

  const filtered = useMemo(() => {
    const cutoff = new Date("2026-08-16T00:00:00");
    cutoff.setDate(cutoff.getDate() - 30);

    return clients.filter(client => {
      const matchesSearch = client.name.toLowerCase().includes(search.toLowerCase()) ||
        client.request.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = !statusFilter || client.status === statusFilter;
      const matchesSpecial =
        !specialFilter ||
        (specialFilter === "new" && new Date(client.joinedDate + "T00:00:00") >= cutoff) ||
        (specialFilter === "attention" && client.needsAttention);
      return matchesSearch && matchesStatus && matchesSpecial;
    });
  }, [clients, search, statusFilter, specialFilter]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    };
  }, []);

  const sendMessage = () => {
    if (!chatInput.trim() && !selectedFile) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "psychologist",
      text: chatInput,
      time: timeStr,
      timestamp: now,
      isRead: true,
      file: selectedFile ? {
        name: selectedFile.name,
        size: (selectedFile.size / 1024).toFixed(1) + " KB",
      } : undefined,
    };

    setMessages(prev => [...prev, newMessage]);
    setChatInput("");
    setSelectedFile(null);

    // Имитация ответа клиента
    setTimeout(() => {
      const replyTime = new Date();
      const replyTimeStr = replyTime.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
      const replyMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "client",
        text: "Спасибо! Я согласен(а) с вашей рекомендацией.",
        time: replyTimeStr,
        timestamp: replyTime,
        isRead: false,
      };
      setMessages(prev => [...prev, replyMessage]);
    }, 2000);
  };

  const formatDuration = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const startRecording = () => {
    setIsRecording(true);
    setRecordSeconds(0);
    recordIntervalRef.current = setInterval(() => {
      setRecordSeconds(prev => prev + 1);
    }, 1000);
  };

  const cancelRecording = () => {
    if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    setIsRecording(false);
    setRecordSeconds(0);
  };

  const sendRecording = () => {
    if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    const duration = recordSeconds;
    setIsRecording(false);
    setRecordSeconds(0);

    if (duration < 1) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "psychologist",
      text: "",
      time: timeStr,
      timestamp: now,
      isRead: true,
      voice: { duration: formatDuration(duration) },
    };
    setMessages(prev => [...prev, newMessage]);

    setTimeout(() => {
      const replyTime = new Date();
      const replyTimeStr = replyTime.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "client",
        text: "Спасибо за голосовое, послушаю и напишу!",
        time: replyTimeStr,
        timestamp: replyTime,
        isRead: false,
      }]);
    }, 2000);
  };

  const toggleReaction = (messageId: string, emoji: string) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg;
      const current = msg.reactions ?? [];
      const has = current.includes(emoji);
      return { ...msg, reactions: has ? current.filter(r => r !== emoji) : [...current, emoji] };
    }));
    setReactionMenuFor(null);
  };

  const loadTestsOrHomework = (type: "tests" | "homework") => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
    const loadedText = type === "tests"
      ? `📊 Загружены тесты клиента:\n• GAD-7: 15/21\n• Депрессия: Умеренная\n• Тревога: Высокая`
      : `✅ Загружены задания:\n• Вести дневник эмоций\n• Упражнения релаксации\n• Анализ триггеров`;

    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "psychologist",
      text: loadedText,
      time: timeStr,
      timestamp: now,
      isRead: true,
    };

    setMessages(prev => [...prev, newMessage]);
  };

  const resetNewClientForm = () => {
    setNewClientName("");
    setNewClientRequest("");
    setNewClientApproach("");
    setNewClientAge("");
    setNewClientGender("female");
    setCreateClientError(null);
  };

  const handleCreateClient = async () => {
    if (!newClientName.trim()) {
      setCreateClientError("Укажите имя клиента");
      return;
    }
    setCreatingClient(true);
    setCreateClientError(null);
    try {
      const created = await createClientRecord({
        name: newClientName.trim(),
        request: newClientRequest.trim() || undefined,
        approach: newClientApproach.trim() || undefined,
        age: newClientAge ? Number(newClientAge) : undefined,
        gender: newClientGender,
      });
      await refreshClients();
      setShowNewClient(false);
      resetNewClientForm();
      setSelectedClientId(created.id);
    } catch (e) {
      setCreateClientError(e instanceof Error ? e.message : "Не удалось создать клиента");
    } finally {
      setCreatingClient(false);
    }
  };

  const statuses = [
    { value: "active", label: "Активные" },
    { value: "pause", label: "На паузе" },
    { value: "completed", label: "Завершено" },
  ];

  return (
    <div style={{ display: "flex", height: "calc(100vh - 120px)", gap: 12 }}>
      {/* Левая колонка - Список клиентов */}
      <div style={{ flex: "0 0 30%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E" }}>
            Клиенты
          </h1>
          <button
            onClick={() => setShowNewClient(true)}
            style={{
              padding: "7px 12px",
              background: "#2D6A5C",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
            }}
          >
            + Новый клиент
          </button>
        </div>

        {specialFilter && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", marginBottom: 12,
            background: specialFilter === "attention" ? "#FEF3E2" : "#E8F2EF",
            border: `1px solid ${specialFilter === "attention" ? "#F59E0B40" : "#2D6A5C40"}`,
            borderRadius: 8,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: specialFilter === "attention" ? "#92400E" : "#2D6A5C" }}>
              {specialFilter === "attention" ? "Показаны клиенты, требующие внимания" : "Показаны новые клиенты за 30 дней"}
            </span>
            <button
              onClick={() => setSpecialFilter(null)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#6B6058", fontWeight: 600 }}
            >
              Сбросить ✕
            </button>
          </div>
        )}

        <div style={{ position: "relative", marginBottom: 12 }}>
          <Input
            placeholder="Поиск клиента..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <Search
            size={16}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#8C7355",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Фильтры */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            onClick={() => setStatusFilter(null)}
            style={{
              padding: "6px 12px",
              background: statusFilter === null ? "#2D6A5C" : "#F5F3EF",
              color: statusFilter === null ? "#FFFFFF" : "#1C1C1E",
              border: "none",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            Все
          </button>
          {statuses.map(s => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              style={{
                padding: "6px 12px",
                background: statusFilter === s.value ? "#2D6A5C" : "#F5F3EF",
                color: statusFilter === s.value ? "#FFFFFF" : "#1C1C1E",
                border: "none",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setSpecialFilter(specialFilter === "attention" ? null : "attention")}
            style={{
              padding: "6px 12px",
              background: specialFilter === "attention" ? "#F59E0B" : "#F5F3EF",
              color: specialFilter === "attention" ? "#FFFFFF" : "#92400E",
              border: "none",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            Требует внимания
          </button>
        </div>

        {/* Список клиентов */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {clientsLoading && (
            <p style={{ fontSize: 12, color: "#8C7355", padding: 12 }}>Загрузка клиентов…</p>
          )}
          {!clientsLoading && filtered.length === 0 && (
            <p style={{ fontSize: 12, color: "#8C7355", padding: 12 }}>Клиенты не найдены</p>
          )}
          <AnimatePresence>
            {filtered.map((client, idx) => (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: idx * 0.02 }}
              >
                <button
                  onClick={() => setSelectedClientId(client.id)}
                  style={{
                    width: "100%",
                    padding: 12,
                    background: selectedClientId === client.id ? "#E8F2EF" : "#FFFFFF",
                    border: selectedClientId === client.id ? "1px solid #2D6A5C" : "1px solid #E5DFD5",
                    borderRadius: 10,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    textAlign: "left",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  <div style={{
                    width: 40,
                    height: 40,
                    background: avatarColors[idx % avatarColors.length],
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#fff",
                    flexShrink: 0,
                  }}>
                    {client.initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>
                      {client.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#8C7355", marginTop: 2 }}>
                      {client.request.substring(0, 30)}...
                    </div>
                  </div>
                  <div style={{
                    padding: "4px 8px",
                    background: client.status === "active" ? "#E6F7F2" : "#FEF3C7",
                    color: client.status === "active" ? "#1BAF7A" : "#F59E0B",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}>
                    {client.status === "active" ? "Активный" : client.status === "pause" ? "На паузе" : "Завершено"}
                  </div>
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Правая колонка */}
      {selectedClient ? (
        <div style={{ flex: "0 0 70%", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          {/* Хедер чата */}
          <div style={{
            padding: "12px 16px",
            background: "#FFFFFF",
            borderBottom: "1px solid #E5DFD5",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flex: "0 0 auto",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                position: "relative",
              }}>
                <div style={{
                  width: 40,
                  height: 40,
                  background: avatarColors[clients.indexOf(selectedClient) % avatarColors.length],
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#fff",
                }}>
                  {selectedClient.initials}
                </div>
                {clientStatus.online && (
                  <div style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 12,
                    height: 12,
                    background: "#1BAF7A",
                    borderRadius: "50%",
                    border: "2px solid #fff",
                  }} />
                )}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>
                  {selectedClient.name}
                </div>
                <div style={{ fontSize: 10, color: clientStatus.online ? "#1BAF7A" : "#8C7355" }}>
                  {clientStatus.online ? "онлайн" : `был(а) ${clientStatus.lastSeen}`}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Link href={`/clients/${selectedClient.id}`} style={{ textDecoration: "none" }}>
                <button
                  style={{
                    padding: "0 14px",
                    height: 36,
                    background: "#2D6A5C",
                    border: "none",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "var(--font-sans)",
                  }}
                  title="Открыть полную карточку клиента"
                >
                  Полная карточка
                </button>
              </Link>
              <button
                onClick={() => setShowProfile(!showProfile)}
                style={{
                  width: 36,
                  height: 36,
                  background: "#F5F3EF",
                  border: "1px solid #E5DFD5",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#2D6A5C",
                  transition: "all 0.2s",
                }}
                title="Быстрый профиль"
              >
                <User size={18} />
              </button>
            </div>
          </div>

          {/* Чат */}
          <Card style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <CardContent style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: 16, boxSizing: "border-box" }}>
              {/* Сообщения */}
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                {messages.map((msg) => {
                  const isMine = msg.role === "psychologist";
                  return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      display: "flex",
                      justifyContent: isMine ? "flex-end" : "flex-start",
                      alignItems: "flex-end",
                      gap: 6,
                    }}
                  >
                    {isMine && (
                      <span style={{
                        fontSize: 12,
                        color: msg.isRead ? "#2D6A5C" : "#8C7355",
                      }}>
                        {msg.isRead ? "✓✓" : "✓"}
                      </span>
                    )}
                    <div
                      style={{ position: "relative" }}
                      onMouseEnter={() => {}}
                      onMouseLeave={() => setReactionMenuFor(prev => (prev === msg.id ? null : prev))}
                    >
                      <div
                        className="chat-bubble-hover"
                        style={{
                          maxWidth: 340,
                          padding: msg.voice ? "10px 14px" : "10px 14px",
                          borderRadius: 8,
                          background: isMine ? "#2D6A5C" : "#F5F3EF",
                          color: isMine ? "#fff" : "#1C1C1E",
                          fontSize: 13,
                          lineHeight: "1.5",
                          whiteSpace: "pre-wrap",
                          wordWrap: "break-word",
                          position: "relative",
                        }}
                      >
                        {/* Кнопка "реакция" — появляется по наведению */}
                        <button
                          onClick={() => setReactionMenuFor(prev => (prev === msg.id ? null : msg.id))}
                          className="chat-reaction-trigger"
                          style={{
                            position: "absolute",
                            top: "50%",
                            transform: "translateY(-50%)",
                            [isMine ? "left" : "right"]: -32,
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            border: "1px solid #E5DFD5",
                            background: "#FFFFFF",
                            color: "#8C7355",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            opacity: 0,
                            transition: "opacity 0.15s",
                          } as React.CSSProperties}
                          title="Поставить реакцию"
                        >
                          <Smile size={13} />
                        </button>

                        {/* Меню выбора эмодзи */}
                        <AnimatePresence>
                          {reactionMenuFor === msg.id && (
                            <motion.div
                              initial={{ opacity: 0, y: 6, scale: 0.9 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 6, scale: 0.9 }}
                              style={{
                                position: "absolute",
                                bottom: "100%",
                                marginBottom: 6,
                                [isMine ? "right" : "left"]: 0,
                                background: "#FFFFFF",
                                border: "1px solid #E5DFD5",
                                borderRadius: 20,
                                padding: "6px 8px",
                                display: "flex",
                                gap: 4,
                                boxShadow: "0 8px 20px rgba(15,22,41,0.12)",
                                zIndex: 10,
                              } as React.CSSProperties}
                            >
                              {REACTION_EMOJIS.map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(msg.id, emoji)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: 16,
                                    padding: 2,
                                    lineHeight: 1,
                                  }}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {msg.voice ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 160 }}>
                            <button
                              onClick={() => setPlayingVoiceId(prev => (prev === msg.id ? null : msg.id))}
                              style={{
                                width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                                border: "none", cursor: "pointer",
                                background: isMine ? "rgba(255,255,255,0.2)" : "#FFFFFF",
                                color: isMine ? "#fff" : "#2D6A5C",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}
                            >
                              {playingVoiceId === msg.id ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}
                            </button>
                            <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
                              {Array.from({ length: 22 }).map((_, i) => (
                                <span
                                  key={i}
                                  style={{
                                    width: 2,
                                    height: 4 + ((i * 37) % 16),
                                    borderRadius: 1,
                                    background: isMine ? "rgba(255,255,255,0.6)" : "#8C7355",
                                    opacity: playingVoiceId === msg.id ? 1 : 0.6,
                                  }}
                                />
                              ))}
                            </div>
                            <span style={{ fontSize: 11, opacity: 0.75, flexShrink: 0 }}>{msg.voice.duration}</span>
                          </div>
                        ) : (
                          <p style={{ margin: 0 }}>{msg.text}</p>
                        )}
                        {msg.file && (
                          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
                            📎 {msg.file.name} ({msg.file.size})
                          </div>
                        )}
                        <span style={{ fontSize: 10, opacity: 0.65, marginTop: 6, display: "block" }}>
                          {formatMessageTime(msg.timestamp)}
                        </span>
                      </div>

                      {msg.reactions && msg.reactions.length > 0 && (
                        <div style={{
                          display: "flex", gap: 3, marginTop: 4,
                          justifyContent: isMine ? "flex-end" : "flex-start",
                        }}>
                          {msg.reactions.map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => toggleReaction(msg.id, emoji)}
                              style={{
                                fontSize: 12,
                                background: "#FFFFFF",
                                border: "1px solid #E5DFD5",
                                borderRadius: 10,
                                padding: "1px 6px",
                                cursor: "pointer",
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Инпут с файлами / режим записи ГС */}
              {isRecording ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  marginTop: 12, padding: "10px 14px",
                  background: "#FEF3E2", border: "1px solid #F59E0B40", borderRadius: 6,
                }}>
                  <motion.div
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    style={{ width: 10, height: 10, borderRadius: "50%", background: "#EF4444", flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E", flexShrink: 0 }}>
                    Запись голосового {formatDuration(recordSeconds)}
                  </span>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 2, overflow: "hidden" }}>
                    {Array.from({ length: 40 }).map((_, i) => (
                      <motion.span
                        key={i}
                        animate={{ height: [4, 4 + ((i * 53) % 18), 4] }}
                        transition={{ duration: 0.6 + (i % 5) * 0.1, repeat: Infinity, ease: "easeInOut" }}
                        style={{ width: 2, borderRadius: 1, background: "#F59E0B", flexShrink: 0 }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={cancelRecording}
                    style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: "#FFFFFF", border: "1px solid #E5DFD5", color: "#8C7355",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                    title="Отменить запись"
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    onClick={sendRecording}
                    style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: "#2D6A5C", border: "none", color: "#FFFFFF",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                    title="Отправить голосовое"
                  >
                    <Send size={14} />
                  </button>
                </div>
              ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flex: "0 0 auto", marginTop: 12 }}>
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
                      width: "100%",
                      padding: "10px 14px",
                      border: "1px solid #E5DFD5",
                      borderRadius: 6,
                      fontSize: 13,
                      fontFamily: "var(--font-sans)",
                      color: "#1C1C1E",
                      resize: "none",
                      maxHeight: 100,
                      boxSizing: "border-box",
                    }}
                    rows={2}
                  />
                  {selectedFile && (
                    <div style={{
                      fontSize: 11,
                      color: "#2D6A5C",
                      marginTop: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}>
                      📎 {selectedFile.name}
                      <button
                        onClick={() => setSelectedFile(null)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#8C7355",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flex: "0 0 auto" }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      width: 36,
                      height: 36,
                      background: "#F5F3EF",
                      border: "1px solid #E5DFD5",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: "#6B6058",
                      transition: "all 0.2s",
                      flexShrink: 0,
                    }}
                    title="Добавить файл"
                  >
                    <Paperclip size={18} />
                  </button>
                  <button
                    onClick={() => {
                      const menu = document.createElement('div');
                      menu.innerHTML = `
                        <button style="padding: 8px 12px; background: #2D6A5C; color: #fff; border: none; border-radius: 4px; cursor: pointer; margin-right: 8px;">Тесты</button>
                        <button style="padding: 8px 12px; background: #1BAF7A; color: #fff; border: none; border-radius: 4px; cursor: pointer;">ДЗ</button>
                      `;
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      background: "#F5F3EF",
                      border: "1px solid #E5DFD5",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: "#6B6058",
                      transition: "all 0.2s",
                      flexShrink: 0,
                    }}
                    title="Загрузить тесты или ДЗ"
                  >
                    <FileText size={18} />
                  </button>
                  <button
                    onClick={startRecording}
                    style={{
                      width: 36,
                      height: 36,
                      background: "#F5F3EF",
                      border: "1px solid #E5DFD5",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: "#6B6058",
                      transition: "all 0.2s",
                      flexShrink: 0,
                    }}
                    title="Записать голосовое сообщение"
                  >
                    <Mic size={18} />
                  </button>
                  <button
                    onClick={sendMessage}
                    disabled={!chatInput.trim() && !selectedFile}
                    style={{
                      width: 36,
                      height: 36,
                      background: "#2D6A5C",
                      border: "none",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: (chatInput.trim() || selectedFile) ? "pointer" : "not-allowed",
                      opacity: (chatInput.trim() || selectedFile) ? 1 : 0.5,
                      color: "#FFFFFF",
                      transition: "all 0.2s",
                      flexShrink: 0,
                    }}
                    title="Отправить"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                onChange={e => {
                  if (e.target.files?.[0]) {
                    setSelectedFile(e.target.files[0]);
                  }
                }}
                style={{ display: "none" }}
              />

              {/* Точка входа в ИИ-ассистента — внизу страницы справа, не поверх чата */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, flex: "0 0 auto" }}>
                <motion.button
                  onClick={() => window.dispatchEvent(new CustomEvent("tolk:open-assistant"))}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "#fff",
                    boxShadow: "0 4px 12px rgba(45, 106, 92, 0.35)",
                    flexShrink: 0,
                  }}
                  title="Спросить ассистента об этом клиенте"
                >
                  <Sparkles size={20} />
                </motion.button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div style={{
          flex: "0 0 70%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#FFFFFF",
          borderRadius: 12,
          border: "1px solid #E5DFD5",
          padding: 24,
          textAlign: "center",
        }}>
          <div style={{
            width: 64,
            height: 64,
            background: "#F5F3EF",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8C7355" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E", margin: "0 0 8px 0" }}>
            Выберите клиента
          </h3>
          <p style={{ fontSize: 14, color: "#6B6058", margin: "0 0 24px 0", maxWidth: 300 }}>
            Нажмите на клиента из списка слева, чтобы открыть его профиль и чат
          </p>
        </div>
      )}

      {/* Модальное окно профиля */}
      <AnimatePresence>
        {showProfile && selectedClient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProfile(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.3)",
                zIndex: 30,
              }}
            />
            <motion.div
              initial={{ x: 600, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 600, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              style={{
                position: "fixed",
                right: 0,
                top: 0,
                bottom: 0,
                width: "600px",
                background: "#FFFFFF",
                boxShadow: "-4px 0 16px rgba(0, 0, 0, 0.1)",
                display: "flex",
                flexDirection: "column",
                zIndex: 35,
                overflowY: "auto",
              }}
            >
              {/* Заголовок профиля */}
              <div style={{
                padding: "16px 20px",
                borderBottom: "1px solid #E5DFD5",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flex: "0 0 auto",
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>Профиль</div>
                <button
                  onClick={() => setShowProfile(false)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#8C7355",
                    padding: "12px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    borderRadius: 6,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#1C1C1E";
                    e.currentTarget.style.background = "#F5F3EF";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#8C7355";
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <X size={24} />
                </button>
              </div>

              {/* Вкладки */}
              <div style={{
                display: "flex",
                gap: 0,
                borderBottom: "1px solid #E5DFD5",
                paddingLeft: 16,
              }}>
                <button
                  onClick={() => setProfileTab("profile")}
                  style={{
                    padding: "12px 12px",
                    background: "none",
                    border: "none",
                    borderBottom: profileTab === "profile" ? "2px solid #2D6A5C" : "2px solid transparent",
                    fontSize: 12,
                    fontWeight: 600,
                    color: profileTab === "profile" ? "#2D6A5C" : "#8C7355",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  Профиль
                </button>
                <button
                  onClick={() => setProfileTab("progress")}
                  style={{
                    padding: "12px 12px",
                    background: "none",
                    border: "none",
                    borderBottom: profileTab === "progress" ? "2px solid #2D6A5C" : "2px solid transparent",
                    fontSize: 12,
                    fontWeight: 600,
                    color: profileTab === "progress" ? "#2D6A5C" : "#8C7355",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  Прогресс
                </button>
              </div>

              {/* Содержимое профиля */}
              <div style={{ padding: "16px", flex: 1, overflowY: "auto" }}>
                {profileTab === "profile" && (
                  <>
                    <div style={{ marginBottom: 20 }}>
                      <div style={{
                        width: 64,
                        height: 64,
                        background: avatarColors[clients.indexOf(selectedClient) % avatarColors.length],
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 24,
                        fontWeight: 700,
                        color: "#fff",
                        marginBottom: 12,
                      }}>
                        {selectedClient.initials}
                      </div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: "0 0 4px 0" }}>
                        {selectedClient.name}
                      </h3>
                      <p style={{ fontSize: 12, color: "#8C7355", margin: 0 }}>
                        {[selectedClient.age ? `${selectedClient.age} лет` : null, selectedClient.gender === "female" ? "Женский" : selectedClient.gender === "male" ? "Мужской" : null].filter(Boolean).join(" · ") || "Данные не указаны"}
                      </p>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 6 }}>Запрос</div>
                      <div style={{ fontSize: 12, color: "#1C1C1E", lineHeight: "1.4" }}>{selectedClient.request}</div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 6 }}>Подход</div>
                      <div style={{ fontSize: 12, color: "#1C1C1E" }}>{selectedClient.approach}</div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 6 }}>Триггеры</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(selectedClient.triggers ?? EMPTY_TRIGGERS).length === 0 && (
                          <span style={{ fontSize: 12, color: "#8C7355" }}>Пока не отмечены</span>
                        )}
                        {(selectedClient.triggers ?? EMPTY_TRIGGERS).map((trigger, i) => (
                          <span key={i} style={{
                            padding: "4px 8px",
                            background: "#E8F2EF",
                            color: "#2D6A5C",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 500,
                          }}>
                            {trigger}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", marginBottom: 6 }}>Последний тест</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>
                        {selectedClient.lastTest
                          ? `${selectedClient.lastTest.name}: ${selectedClient.lastTest.score}`
                          : "Тесты ещё не проводились"}
                      </div>
                    </div>
                  </>
                )}

                {profileTab === "progress" && (
                  <ClientProgressScale
                    clientName={selectedClient.name}
                    progress={selectedClient.progress ?? EMPTY_PROGRESS}
                  />
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Модальное окно создания клиента */}
      <AnimatePresence>
        {showNewClient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !creatingClient && setShowNewClient(false)}
              style={{
                position: "fixed", inset: 0,
                background: "rgba(0, 0, 0, 0.4)",
                zIndex: 60,
                backdropFilter: "blur(2px)",
              }}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 320 }}
              style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: 65,
              }}
            >
              <div style={{
                background: "#FFFFFF",
                borderRadius: 16,
                boxShadow: "0 25px 80px rgba(0, 0, 0, 0.2)",
                width: "90%",
                maxWidth: 420,
                maxHeight: "85vh",
                overflowY: "auto",
              }}>
                <div style={{
                  padding: "20px 24px",
                  borderBottom: "1px solid #E5DFD5",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                    Новый клиент
                  </h2>
                  <button
                    onClick={() => !creatingClient && setShowNewClient(false)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355", padding: 4 }}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                      Имя *
                    </label>
                    <Input
                      placeholder="Имя и фамилия"
                      value={newClientName}
                      onChange={e => setNewClientName(e.target.value)}
                    />
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                        Возраст
                      </label>
                      <Input
                        type="number"
                        placeholder="32"
                        value={newClientAge}
                        onChange={e => setNewClientAge(e.target.value)}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                        Пол
                      </label>
                      <select
                        value={newClientGender}
                        onChange={e => setNewClientGender(e.target.value as "male" | "female")}
                        style={{
                          width: "100%", padding: "9px 12px",
                          border: "1px solid #E5DFD5", borderRadius: 8,
                          fontSize: 13, color: "#1C1C1E",
                          fontFamily: "var(--font-sans)", background: "#FFFFFF",
                        }}
                      >
                        <option value="female">Женский</option>
                        <option value="male">Мужской</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                      Запрос
                    </label>
                    <Input
                      placeholder="Например: тревожность, панические атаки"
                      value={newClientRequest}
                      onChange={e => setNewClientRequest(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                      Подход
                    </label>
                    <Input
                      placeholder="Например: КПТ"
                      value={newClientApproach}
                      onChange={e => setNewClientApproach(e.target.value)}
                    />
                  </div>

                  {createClientError && (
                    <p style={{ fontSize: 12.5, color: "#EF4444", background: "#FEE2E2", borderRadius: 8, padding: "8px 12px", margin: 0 }}>
                      {createClientError}
                    </p>
                  )}

                  <button
                    onClick={handleCreateClient}
                    disabled={creatingClient}
                    style={{
                      marginTop: 4, padding: "12px",
                      background: creatingClient ? "#1F4E43" : "#2D6A5C",
                      color: "#fff", border: "none", borderRadius: 10,
                      fontSize: 14, fontWeight: 600,
                      cursor: creatingClient ? "not-allowed" : "pointer",
                    }}
                  >
                    {creatingClient ? "Создаём..." : "Создать клиента"}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={null}>
      <ClientsPageInner />
    </Suspense>
  );
}
