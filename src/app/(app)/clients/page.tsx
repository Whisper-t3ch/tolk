"use client";
import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Send, Paperclip, X, Sparkles, BookOpen } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { useClients } from "@/lib/ClientsContext";
import { createClientRecord } from "@/lib/data/clients";
import { Card, CardContent, Input } from "@/components/ui";

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

// Раньше здесь была симуляция статуса "онлайн"/"был(а) N мин назад" через
// Math.random() — платформа не имеет доступа к реальному presence-статусу
// клиента в Telegram/VK (боты этого не видят), поэтому такой индикатор
// был чистой выдумкой, выглядящей как настоящие данные. Единственный
// реально известный факт — привязан ли у клиента мессенджер вообще.

interface ChatMessage {
  id: string;
  role: "client" | "psychologist";
  text: string;
  time: string;
  timestamp: Date;
  status?: "pending" | "sent" | "delivered" | "failed";
  errorMessage?: string | null;
  file?: { name: string; size: string };
}

// Материал из базы знаний (/api/knowledge), доступный для вставки в
// сообщение клиенту прямо из чата — то же, что вкладки "Техники" /
// "Материалы" в разделе База знаний, просто отфильтрованное подмножество
// полей, нужных только для выбора и вставки текста.
interface KnowledgeAttachItem {
  id: string;
  title: string | null;
  content: string;
  source_type: string;
}

// Короткие ярлыки типов материала для пикера вложений — те же подписи,
// что в разделе База знаний, продублированы здесь, чтобы не тащить
// зависимость между независимыми страницами ради одной константы.
const ATTACH_SOURCE_TYPE_LABELS: Record<string, string> = {
  technique: "Техника",
  homework: "ДЗ",
  article: "Материал",
  manual: "Материал",
  protocol: "Протокол",
  test: "Тест",
};

interface MessengerLink {
  platform: "telegram" | "vk";
  external_username: string | null;
  linked_at: string;
}

// Приводит запись из таблицы messages (API-формат) к формату чата на экране.
function toChatMessage(raw: {
  id: string; direction: string; text: string; created_at: string;
  status: string; error_message: string | null;
}): ChatMessage {
  return {
    id: raw.id,
    role: raw.direction === "incoming" ? "client" : "psychologist",
    text: raw.text,
    time: new Date(raw.created_at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
    timestamp: new Date(raw.created_at),
    status: raw.status as ChatMessage["status"],
    errorMessage: raw.error_message,
  };
}

function ClientsPageInner() {
  const { clients, loading: clientsLoading, error: clientsError, refresh: refreshClients } = useClients();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clientFromUrl = searchParams.get("client");
  const filterFromUrl = searchParams.get("filter"); // "new" | "attention" | null

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [specialFilter, setSpecialFilter] = useState<string | null>(filterFromUrl);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(clientFromUrl || null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messengerLinks, setMessengerLinks] = useState<MessengerLink[]>([]);
  const [sendChannel, setSendChannel] = useState<"telegram" | "vk">("telegram");
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [attachItems, setAttachItems] = useState<KnowledgeAttachItem[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachSearch, setAttachSearch] = useState("");
  const [attachTypeFilter, setAttachTypeFilter] = useState<string>("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientRequest, setNewClientRequest] = useState("");
  const [newClientApproach, setNewClientApproach] = useState("");
  const [newClientAge, setNewClientAge] = useState("");
  const [newClientGender, setNewClientGender] = useState<"male" | "female">("female");
  const [creatingClient, setCreatingClient] = useState(false);
  const [createClientError, setCreateClientError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedClient = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;
  const hasMessengerLink = messengerLinks.length > 0;

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
    const end = messagesEndRef.current;
    if (!end) return;
    // Прокручиваем сам контейнер в requestAnimationFrame, а не
    // scrollIntoView({behavior:"smooth"}) — плавная анимация стартовала
    // раньше, чем длинные сообщения получали финальную высоту, и
    // останавливалась, не дойдя до низа: последнее сообщение оставалось
    // обрезанным при каждом открытии чата.
    const container = end.parentElement;
    const raf = requestAnimationFrame(() => {
      if (container) container.scrollTop = container.scrollHeight;
      else end.scrollIntoView({ block: "end" });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages]);

  // Загружаем реальную историю переписки при выборе клиента — эффект
  // должен полностью заменять messages (не дописывать), т.к. страница не
  // размонтируется между переключениями клиентов в списке слева.
  useEffect(() => {
    if (!selectedClientId) {
      setMessages([]);
      setMessengerLinks([]);
      setMessagesLoading(false);
      return;
    }
    let cancelled = false;
    async function loadMessages() {
      setMessagesLoading(true);
      setMessages([]);
      try {
        const res = await fetch(`/api/messages?client_id=${selectedClientId}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setMessages((data.messages ?? []).map(toChatMessage));
          setMessengerLinks(data.links ?? []);
          setSendChannel((data.links ?? []).some((l: MessengerLink) => l.platform === "vk") ? "vk" : "telegram");
        }
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }
    loadMessages();
    return () => { cancelled = true; };
  }, [selectedClientId]);

  const sendMessage = async () => {
    if (!chatInput.trim() || sending || !selectedClientId) return;
    // Вложения пока не поддерживаются реальной отправкой — Telegram/VK
    // API для файлов требует отдельной загрузки, добавим отдельно.
    const text = chatInput;
    setChatInput("");
    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: selectedClientId, text, channel: sendChannel }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages(prev => [...prev, toChatMessage(data.message)]);
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

  // Открывает выбор материала из базы знаний для вставки в сообщение
  // клиенту — тот же паттерн, что и в /clients/[id]. /api/knowledge
  // возвращает ВСЮ базу знаний психолога (техники, ДЗ, тесты, протоколы,
  // материалы) без фильтра по source_type — поиск и фильтр по типу ниже
  // работают локально по уже загруженному списку.
  const openAttachPicker = async () => {
    setShowAttachPicker(true);
    setAttachSearch("");
    setAttachTypeFilter("");
    if (attachItems.length > 0 || attachLoading) return;
    setAttachLoading(true);
    setAttachError(null);
    try {
      const res = await fetch("/api/knowledge");
      const data = await res.json();
      if (!res.ok) {
        setAttachError(data?.error ?? "Не удалось загрузить материалы");
        return;
      }
      setAttachItems(data.items ?? []);
    } catch {
      setAttachError("Не удалось связаться с сервером");
    } finally {
      setAttachLoading(false);
    }
  };

  // Вставляет текст материала в поле ввода — психолог может
  // отредактировать перед отправкой.
  const attachMaterial = (item: KnowledgeAttachItem) => {
    setChatInput(prev => (prev ? `${prev}\n\n${item.content}` : item.content));
    setShowAttachPicker(false);
  };

  // Фильтруем и дедуплицируем по подписи, а не по source_type: article и
  // manual оба показываются как «Материал», из-за чего в пикере рисовались
  // две визуально одинаковые кнопки-фильтра, каждая со своей половиной
  // материалов — психолог не мог понять, чем они отличаются.
  const attachLabelOf = (sourceType: string) =>
    ATTACH_SOURCE_TYPE_LABELS[sourceType] ?? sourceType;

  const filteredAttachItems = useMemo(() => {
    const query = attachSearch.trim().toLowerCase();
    return attachItems.filter(item => {
      const matchesType = !attachTypeFilter || attachLabelOf(item.source_type) === attachTypeFilter;
      const matchesSearch = !query
        || (item.title ?? "").toLowerCase().includes(query)
        || item.content.toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [attachItems, attachSearch, attachTypeFilter]);

  const attachAvailableTypes = useMemo(
    () => Array.from(new Set(attachItems.map(i => attachLabelOf(i.source_type)))),
    [attachItems]
  );

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
          {!clientsLoading && clientsError && (
            <div style={{ padding: 12, background: "#FEE2E2", borderRadius: 8, margin: 12 }}>
              <p style={{ fontSize: 12, color: "#EF4444", margin: 0, marginBottom: 6 }}>
                Не удалось загрузить клиентов: {clientsError}
              </p>
              <button
                onClick={refreshClients}
                style={{ fontSize: 11, color: "#2D6A5C", fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                Попробовать снова
              </button>
            </div>
          )}
          {!clientsLoading && !clientsError && filtered.length === 0 && (
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
            <motion.div
              onClick={() => router.push(`/clients/${selectedClient.id}`)}
              whileHover={{ opacity: 0.75 }}
              style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
              title="Открыть полную карточку клиента"
            >
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
                {hasMessengerLink && (
                  <div style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 12,
                    height: 12,
                    background: "#1BAF7A",
                    borderRadius: "50%",
                    border: "2px solid #fff",
                  }} title="Мессенджер подключён" />
                )}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>
                  {selectedClient.name}
                </div>
                <div style={{ fontSize: 10, color: hasMessengerLink ? "#1BAF7A" : "#8C7355" }}>
                  {hasMessengerLink ? "мессенджер подключён" : "мессенджер не подключён"}
                </div>
              </div>
            </motion.div>
          </div>

          {/* Чат */}
          <Card style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <CardContent style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: 16, boxSizing: "border-box" }}>
              {/* Сообщения */}
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                {messagesLoading && (
                  <p style={{ fontSize: 12, color: "#8C7355", textAlign: "center", marginTop: 20 }}>Загрузка переписки…</p>
                )}
                {!messagesLoading && messages.length === 0 && (
                  <p style={{ fontSize: 12, color: "#8C7355", textAlign: "center", marginTop: 20 }}>Переписки пока нет</p>
                )}
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
                    <div
                      className="chat-bubble-hover"
                      style={{
                        maxWidth: 340,
                        padding: "10px 14px",
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
                      <p style={{ margin: 0 }}>{msg.text}</p>
                      {msg.file && (
                        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
                          📎 {msg.file.name} ({msg.file.size})
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                        <span style={{ fontSize: 10, opacity: 0.65 }}>
                          {formatMessageTime(msg.timestamp)}
                        </span>
                        {isMine && msg.status === "pending" && (
                          <span style={{ fontSize: 10, opacity: 0.75 }} title={msg.errorMessage ?? "Клиент ещё не подключил чат"}>· не доставлено</span>
                        )}
                        {isMine && msg.status === "failed" && (
                          <span style={{ fontSize: 10, color: "#FCA5A5" }} title={msg.errorMessage ?? ""}>· ошибка отправки</span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                  );
                })}
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

              {/* Инпут */}
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
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flex: "0 0 auto" }}>
                  <button
                    onClick={openAttachPicker}
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
                    title="Прикрепить материал из базы знаний"
                  >
                    <Paperclip size={18} />
                  </button>
                  <button
                    onClick={sendMessage}
                    disabled={sending || !chatInput.trim()}
                    style={{
                      width: 36,
                      height: 36,
                      background: "#2D6A5C",
                      border: "none",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: (sending || !chatInput.trim()) ? "not-allowed" : "pointer",
                      opacity: (sending || !chatInput.trim()) ? 0.5 : 1,
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

      {/* Выбор материала из базы знаний для вставки в сообщение клиенту */}
      <AnimatePresence>
        {showAttachPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowAttachPicker(false)}
            style={{
              position: "fixed", inset: 0, background: "rgba(28,28,30,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 100, padding: 24,
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#FFFFFF", borderRadius: 16, width: "100%", maxWidth: 520,
                maxHeight: "80vh", display: "flex", flexDirection: "column",
                boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden",
              }}
            >
              <div style={{
                padding: "18px 20px", borderBottom: "1px solid #EFEAE0",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <BookOpen size={16} style={{ color: "#2D6A5C" }} />
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                    Прикрепить материал
                  </h3>
                </div>
                <button
                  onClick={() => setShowAttachPicker(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355", padding: 4 }}
                >
                  <X size={18} />
                </button>
              </div>

              {!attachLoading && !attachError && attachItems.length > 0 && (
                <div style={{ padding: "12px 20px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#8C7355" }} />
                    <input
                      value={attachSearch}
                      onChange={e => setAttachSearch(e.target.value)}
                      placeholder="Поиск по базе знаний..."
                      style={{
                        width: "100%", padding: "8px 10px 8px 32px", border: "1px solid #E5DFD5",
                        borderRadius: 8, fontSize: 13, color: "#1C1C1E", boxSizing: "border-box",
                        fontFamily: "var(--font-sans)",
                      }}
                    />
                  </div>
                  {attachAvailableTypes.length > 1 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        onClick={() => setAttachTypeFilter("")}
                        style={{
                          padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer",
                          fontSize: 11, fontWeight: 600, fontFamily: "var(--font-sans)",
                          background: attachTypeFilter === "" ? "#2D6A5C" : "#F5F3EF",
                          color: attachTypeFilter === "" ? "#FFFFFF" : "#6B6058",
                        }}
                      >
                        Все
                      </button>
                      {attachAvailableTypes.map(type => (
                        <button
                          key={type}
                          onClick={() => setAttachTypeFilter(prev => (prev === type ? "" : type))}
                          style={{
                            padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer",
                            fontSize: 11, fontWeight: 600, fontFamily: "var(--font-sans)",
                            background: attachTypeFilter === type ? "#2D6A5C" : "#F5F3EF",
                            color: attachTypeFilter === type ? "#FFFFFF" : "#6B6058",
                          }}
                        >
                          {ATTACH_SOURCE_TYPE_LABELS[type] ?? type}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ overflowY: "auto", padding: "8px 12px", flex: 1 }}>
                {attachLoading && (
                  <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "#8C7355" }}>
                    Загрузка материалов...
                  </div>
                )}
                {attachError && !attachLoading && (
                  <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "#C0392B" }}>
                    {attachError}
                  </div>
                )}
                {!attachLoading && !attachError && attachItems.length === 0 && (
                  <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "#8C7355" }}>
                    В базе знаний пока нет материалов
                  </div>
                )}
                {!attachLoading && !attachError && attachItems.length > 0 && filteredAttachItems.length === 0 && (
                  <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "#8C7355" }}>
                    Ничего не найдено
                  </div>
                )}
                {!attachLoading && !attachError && filteredAttachItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => attachMaterial(item)}
                    style={{
                      width: "100%", textAlign: "left", background: "none", border: "none",
                      borderBottom: "1px solid #F5F1E8", padding: "12px 8px", cursor: "pointer",
                      display: "flex", flexDirection: "column", gap: 4, fontFamily: "var(--font-sans)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: "#2D6A5C", background: "#E8F2EF",
                        padding: "2px 6px", borderRadius: 4, flexShrink: 0,
                      }}>
                        {ATTACH_SOURCE_TYPE_LABELS[item.source_type] ?? item.source_type}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>
                        {item.title ?? "Без названия"}
                      </span>
                    </div>
                    <p style={{
                      fontSize: 12, color: "#6B6058", margin: 0, lineHeight: 1.5,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                    }}>
                      {item.content}
                    </p>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
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
