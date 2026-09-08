"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, BookOpen, Trash2, X, Loader2, Send, ClipboardList } from "lucide-react";
import { Button, Card, CardContent, Badge, Tabs } from "@/components/ui";
import { useClients } from "@/lib/useClients";
import { APPROACH_LABELS, type Approach } from "@/lib/approaches";

// Материалы, засеянные автоматически при онбординге, хранят approach как
// сырой ключ ("cbt", "gestalt", ...) — переводим на русский для UI.
// Материалы, добавленные психологом вручную, могут содержать произвольный
// текст (форма — обычный input) — в этом случае просто показываем как есть.
function approachLabel(value: string | null): string | null {
  if (!value) return null;
  return APPROACH_LABELS[value as Approach] ?? value;
}

// ------------------------------------------------------------
// Раздел "База знаний" — пять вкладок поверх ОДНОЙ реальной таблицы
// knowledge_base (через /api/knowledge), различаемые по source_type:
//   - "Техники" — source_type: "technique"
//   - "Шаблоны ДЗ" — source_type: "homework" (готовый текст сообщения,
//     который отправляется клиенту как есть)
//   - "Тесты" — source_type: "test" (открытые/российские
//     диагностические методики — не защищённые авторским правом шкалы)
//   - "Шаблоны протоколов" — source_type: "protocol" (перенесено сюда
//     из отдельного пункта меню /note-templates — формат заметки
//     сессии, не сама заполненная заметка конкретного клиента)
//   - "Материалы" — всё остальное (article/manual) плюс форма
//     добавления любого материала
//
// Каждый материал дополнительно может иметь topic (тема/проблема,
// например "тревога", "отношения") — свободный текст, используется
// для группировки и фильтрации внутри вкладки.
// ------------------------------------------------------------

interface KnowledgeItem {
  id: string;
  title: string | null;
  content: string;
  source_type: "technique" | "article" | "protocol" | "manual" | "homework" | "test";
  approach: string | null;
  topic: string | null;
  created_at: string;
}

const SOURCE_TYPE_LABELS: Record<KnowledgeItem["source_type"], string> = {
  technique: "Техника",
  article: "Статья",
  protocol: "Шаблон протокола",
  manual: "Материал",
  homework: "Домашнее задание",
  test: "Тест",
};

function useKnowledgeItems() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await fetch("/api/knowledge");
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data?.error ?? "Не удалось загрузить материалы");
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setLoadError("Не удалось связаться с сервером");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  return { items, loading, loadError, reload: loadItems };
}

// ------------------------------------------------------------
// Фильтры по теме и подходу — общий хук для вкладок со списком
// материалов (Техники/Материалы/Тесты). У ДЗ и Шаблонов протоколов
// собственная более простая структура (карточек обычно меньше), но
// то же поле topic там тоже участвует в отображении бейджем.
// ------------------------------------------------------------
function useTopicApproachFilter(items: KnowledgeItem[]) {
  const [topicFilter, setTopicFilter] = useState<string>("");
  const [approachFilter, setApproachFilter] = useState<string>("");

  const topics = useMemo(
    () => Array.from(new Set(items.map(i => i.topic).filter((t): t is string => Boolean(t)))).sort(),
    [items]
  );
  const approaches = useMemo(
    () => Array.from(new Set(items.map(i => i.approach).filter((a): a is string => Boolean(a)))).sort(),
    [items]
  );

  const filtered = items.filter(
    i => (!topicFilter || i.topic === topicFilter) && (!approachFilter || i.approach === approachFilter)
  );

  return { filtered, topics, approaches, topicFilter, setTopicFilter, approachFilter, setApproachFilter };
}

function FilterBar({
  topics,
  approaches,
  topicFilter,
  setTopicFilter,
  approachFilter,
  setApproachFilter,
}: {
  topics: string[];
  approaches: string[];
  topicFilter: string;
  setTopicFilter: (v: string) => void;
  approachFilter: string;
  setApproachFilter: (v: string) => void;
}) {
  if (topics.length === 0 && approaches.length === 0) return null;
  const selectStyle: React.CSSProperties = {
    padding: "6px 10px", border: "1px solid #E5DFD5", borderRadius: 8,
    fontSize: 12.5, color: "#1C1C1E", background: "#fff", fontFamily: "var(--font-sans)",
  };
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      {topics.length > 0 && (
        <select value={topicFilter} onChange={e => setTopicFilter(e.target.value)} style={selectStyle}>
          <option value="">Все темы</option>
          {topics.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}
      {approaches.length > 0 && (
        <select value={approachFilter} onChange={e => setApproachFilter(e.target.value)} style={selectStyle}>
          <option value="">Все подходы</option>
          {approaches.map(a => (
            <option key={a} value={a}>{approachLabel(a)}</option>
          ))}
        </select>
      )}
      {(topicFilter || approachFilter) && (
        <button
          onClick={() => { setTopicFilter(""); setApproachFilter(""); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355", fontSize: 12.5, padding: "6px 4px" }}
        >
          Сбросить
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Модалка просмотра — общая для всех вкладок, показывает полный текст
// материала (карточки в списках обрезают текст превью). Раньше клик
// по карточке ничего не делал — единственным способом увидеть полный
// текст было открыть форму редактирования (которой тоже не было).
// ------------------------------------------------------------
function ViewModal({ item, onClose }: { item: KnowledgeItem | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {item && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }}
          />
          <div style={{ position: "fixed", inset: 0, zIndex: 45, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, pointerEvents: "none" }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{
                background: "#FFFFFF", borderRadius: 16, width: "90%", maxWidth: 640, maxHeight: "85vh",
                overflowY: "auto", boxShadow: "0 25px 80px rgba(0,0,0,0.2)", pointerEvents: "auto",
              }}
            >
              <div style={{ padding: 24, borderBottom: "1px solid #E5DFD5", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                    {item.title || "Без названия"}
                  </h3>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <Badge variant="muted">{SOURCE_TYPE_LABELS[item.source_type]}</Badge>
                    {item.approach && <Badge variant="muted">{approachLabel(item.approach)}</Badge>}
                    {item.topic && <Badge variant="muted">{item.topic}</Badge>}
                  </div>
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355", flexShrink: 0 }}>
                  <X size={20} />
                </button>
              </div>
              <div style={{ padding: 24 }}>
                <p style={{ fontSize: 13.5, color: "#1C1C1E", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>
                  {item.content}
                </p>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------
// Вкладка "Техники" — справочные материалы для психолога
// (source_type: "technique"), read-only список без формы добавления
// (добавление — только через вкладку "Материалы", единая точка входа).
// ------------------------------------------------------------
function TechniquesTab({
  items,
  loading,
  loadError,
}: {
  items: KnowledgeItem[];
  loading: boolean;
  loadError: string | null;
}) {
  const allTechniques = items.filter(i => i.source_type === "technique");
  const { filtered, topics, approaches, topicFilter, setTopicFilter, approachFilter, setApproachFilter } =
    useTopicApproachFilter(allTechniques);
  const [viewing, setViewing] = useState<KnowledgeItem | null>(null);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#8C7355", fontSize: 13 }}>Загрузка…</div>;
  }
  if (loadError) {
    return (
      <div style={{ padding: 12, background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, color: "#B91C1C", fontSize: 13 }}>
        {loadError}
      </div>
    );
  }
  if (allTechniques.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <BookOpen size={48} style={{ color: "#8C7355", margin: "0 auto 16px" }} />
        <p style={{ color: "#6B6058", marginBottom: 0 }}>
          Пока нет техник — они появляются автоматически при онбординге по выбранному подходу, либо добавьте свою во вкладке «Материалы».
        </p>
      </div>
    );
  }

  return (
    <div>
      <FilterBar
        topics={topics} approaches={approaches}
        topicFilter={topicFilter} setTopicFilter={setTopicFilter}
        approachFilter={approachFilter} setApproachFilter={setApproachFilter}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
        {filtered.map((tech, idx) => (
          <motion.div key={tech.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
            <Card hoverable onClick={() => setViewing(tech)} style={{ cursor: "pointer" }}>
              <CardContent className="pt-6">
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                  {tech.title || "Без названия"}
                </h4>
                <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 12, lineHeight: 1.5 }}>
                  {tech.content.length > 220 ? `${tech.content.slice(0, 220)}…` : tech.content}
                </p>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {tech.approach && <Badge variant="muted">{approachLabel(tech.approach)}</Badge>}
                  {tech.topic && <Badge variant="muted">{tech.topic}</Badge>}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
      <ViewModal item={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

// ------------------------------------------------------------
// Вкладка "Шаблоны ДЗ" — готовые тексты для отправки клиенту
// (source_type: "homework"). Клик по карточке открывает просмотр
// полного текста; кнопка "Отправить" открывает выбор реального
// клиента и вызывает POST /api/clients/[id]/homework.
// ------------------------------------------------------------
function HomeworkTemplatesTab({
  items,
  loading,
  loadError,
  onNotify,
}: {
  items: KnowledgeItem[];
  loading: boolean;
  loadError: string | null;
  onNotify: (msg: string) => void;
}) {
  const { clients, loading: clientsLoading } = useClients();
  const [pickerFor, setPickerFor] = useState<KnowledgeItem | null>(null);
  const [viewing, setViewing] = useState<KnowledgeItem | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const templates = items.filter(i => i.source_type === "homework");

  const openPicker = (item: KnowledgeItem) => {
    setPickerFor(item);
    setSelectedClientId("");
    setSendError(null);
  };

  const send = async () => {
    if (!pickerFor || !selectedClientId) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/clients/${selectedClientId}/homework`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homework_text: pickerFor.content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data?.error ?? "Не удалось отправить домашнее задание");
        return;
      }
      const clientName = clients.find(c => c.id === selectedClientId)?.name ?? "клиенту";
      onNotify(data?.note ? String(data.note) : `Домашнее задание отправлено: ${clientName}`);
      setPickerFor(null);
    } catch {
      setSendError("Не удалось связаться с сервером");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#8C7355", fontSize: 13 }}>Загрузка…</div>;
  }
  if (loadError) {
    return (
      <div style={{ padding: 12, background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, color: "#B91C1C", fontSize: 13 }}>
        {loadError}
      </div>
    );
  }

  return (
    <div>
      {templates.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <BookOpen size={48} style={{ color: "#8C7355", margin: "0 auto 16px" }} />
          <p style={{ color: "#6B6058", marginBottom: 0 }}>
            Пока нет шаблонов домашних заданий — добавьте свой во вкладке «Материалы» с типом «Домашнее задание».
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
          {templates.map((template, idx) => (
            <motion.div key={template.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
              <Card hoverable>
                <CardContent className="pt-6">
                  <div onClick={() => setViewing(template)} style={{ cursor: "pointer" }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                      {template.title || "Без названия"}
                    </h4>
                    <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 12, lineHeight: 1.5 }}>
                      {template.content.length > 200 ? `${template.content.slice(0, 200)}…` : template.content}
                    </p>
                    {(template.approach || template.topic) && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                        {template.approach && <Badge variant="muted">{approachLabel(template.approach)}</Badge>}
                        {template.topic && <Badge variant="muted">{template.topic}</Badge>}
                      </div>
                    )}
                  </div>
                  <Button onClick={() => openPicker(template)} variant="secondary" size="sm" className="w-full">
                    <Send size={13} style={{ marginRight: 6 }} /> Отправить клиенту
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <ViewModal item={viewing} onClose={() => setViewing(null)} />

      {/* Модал выбора клиента */}
      <AnimatePresence>
        {pickerFor && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !sending && setPickerFor(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }}
            />
            <div style={{ position: "fixed", inset: 0, zIndex: 45, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, pointerEvents: "none" }}>
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                style={{
                  background: "#FFFFFF", borderRadius: 16, width: "90%", maxWidth: 460,
                  boxShadow: "0 25px 80px rgba(0,0,0,0.2)", pointerEvents: "auto",
                }}
              >
                <div style={{ padding: 24, borderBottom: "1px solid #E5DFD5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>Кому отправить</h3>
                  <button
                    onClick={() => !sending && setPickerFor(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355" }}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
                  <p style={{ fontSize: 12.5, color: "#6B6058", margin: 0 }}>«{pickerFor.title || "Домашнее задание"}»</p>
                  {clientsLoading ? (
                    <div style={{ fontSize: 13, color: "#8C7355" }}>Загружаю список клиентов…</div>
                  ) : clients.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#8C7355" }}>У вас пока нет клиентов.</div>
                  ) : (
                    <select
                      value={selectedClientId}
                      onChange={e => setSelectedClientId(e.target.value)}
                      style={{
                        width: "100%", padding: "9px 12px", border: "1px solid #E5DFD5",
                        borderRadius: 8, fontSize: 13, color: "#1C1C1E", boxSizing: "border-box", background: "#fff",
                      }}
                    >
                      <option value="">Выберите клиента…</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                  {sendError && <div style={{ fontSize: 12, color: "#B91C1C" }}>{sendError}</div>}
                  <Button size="md" className="w-full" onClick={send} disabled={sending || !selectedClientId}>
                    {sending ? (
                      <>
                        <Loader2 size={15} style={{ marginRight: 8, animation: "knowledgeSpin 1s linear infinite" }} />
                        Отправляем…
                      </>
                    ) : (
                      "Отправить"
                    )}
                  </Button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------
// Вкладка "Тесты" — открытые/российские диагностические методики
// (source_type: "test"). Read-only список, как "Техники" — тексты уже
// содержат вопросы/шкалы/интерпретацию там, где это применимо, без
// добавления собственной формы (методики не создаются на лету).
// ------------------------------------------------------------
function TestsTab({
  items,
  loading,
  loadError,
  onNotify,
}: {
  items: KnowledgeItem[];
  loading: boolean;
  loadError: string | null;
  onNotify: (msg: string) => void;
}) {
  const { clients, loading: clientsLoading } = useClients();
  const tests = items.filter(i => i.source_type === "test");
  const [viewing, setViewing] = useState<KnowledgeItem | null>(null);
  const [pickerFor, setPickerFor] = useState<KnowledgeItem | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const openPicker = (item: KnowledgeItem) => {
    setPickerFor(item);
    setSelectedClientId("");
    setSendError(null);
  };

  // Отправляет бланк теста клиенту тем же путём, что и обычное
  // сообщение в чате (/api/messages) — без отдельного "интерактивного
  // прохождения": психолог сам решает, в каком месте разговора уместно
  // прислать методику, а клиент отвечает текстом в чате как обычно.
  const send = async () => {
    if (!pickerFor || !selectedClientId) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: selectedClientId, text: pickerFor.content, channel: "telegram" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data?.error ?? "Не удалось отправить тест");
        return;
      }
      const clientName = clients.find(c => c.id === selectedClientId)?.name ?? "клиенту";
      onNotify(`Тест отправлен: ${clientName}`);
      setPickerFor(null);
    } catch {
      setSendError("Не удалось связаться с сервером");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#8C7355", fontSize: 13 }}>Загрузка…</div>;
  }
  if (loadError) {
    return (
      <div style={{ padding: 12, background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, color: "#B91C1C", fontSize: 13 }}>
        {loadError}
      </div>
    );
  }
  if (tests.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <ClipboardList size={48} style={{ color: "#8C7355", margin: "0 auto 16px" }} />
        <p style={{ color: "#6B6058", marginBottom: 0 }}>
          Пока нет тестов — добавьте открытую методику во вкладке «Материалы» с типом «Тест».
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#6B6058", marginBottom: 16 }}>
        Только открытые и российские диагностические методики, не защищённые авторским правом.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
        {tests.map((test, idx) => (
          <motion.div key={test.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
            <Card hoverable>
              <CardContent className="pt-6">
                <div onClick={() => setViewing(test)} style={{ cursor: "pointer" }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                    {test.title || "Без названия"}
                  </h4>
                  <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 12, lineHeight: 1.5 }}>
                    {test.content.length > 220 ? `${test.content.slice(0, 220)}…` : test.content}
                  </p>
                  {test.topic && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                      <Badge variant="muted">{test.topic}</Badge>
                    </div>
                  )}
                </div>
                <Button onClick={() => openPicker(test)} variant="secondary" size="sm" className="w-full">
                  <Send size={13} style={{ marginRight: 6 }} /> Отправить клиенту
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
      <ViewModal item={viewing} onClose={() => setViewing(null)} />

      {/* Модал выбора клиента */}
      <AnimatePresence>
        {pickerFor && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !sending && setPickerFor(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }}
            />
            <div style={{ position: "fixed", inset: 0, zIndex: 45, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, pointerEvents: "none" }}>
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                style={{
                  background: "#FFFFFF", borderRadius: 16, width: "90%", maxWidth: 460,
                  boxShadow: "0 25px 80px rgba(0,0,0,0.2)", pointerEvents: "auto",
                }}
              >
                <div style={{ padding: 24, borderBottom: "1px solid #E5DFD5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>Кому отправить</h3>
                  <button
                    onClick={() => !sending && setPickerFor(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355" }}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
                  <p style={{ fontSize: 12.5, color: "#6B6058", margin: 0 }}>«{pickerFor.title || "Тест"}»</p>
                  {clientsLoading ? (
                    <div style={{ fontSize: 13, color: "#8C7355" }}>Загружаю список клиентов…</div>
                  ) : clients.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#8C7355" }}>У вас пока нет клиентов.</div>
                  ) : (
                    <select
                      value={selectedClientId}
                      onChange={e => setSelectedClientId(e.target.value)}
                      style={{
                        width: "100%", padding: "9px 12px", border: "1px solid #E5DFD5",
                        borderRadius: 8, fontSize: 13, color: "#1C1C1E", boxSizing: "border-box", background: "#fff",
                      }}
                    >
                      <option value="">Выберите клиента…</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                  {sendError && <div style={{ fontSize: 12, color: "#B91C1C" }}>{sendError}</div>}
                  <Button size="md" className="w-full" onClick={send} disabled={sending || !selectedClientId}>
                    {sending ? (
                      <>
                        <Loader2 size={15} style={{ marginRight: 8, animation: "knowledgeSpin 1s linear infinite" }} />
                        Отправляем…
                      </>
                    ) : (
                      "Отправить"
                    )}
                  </Button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------
// Вкладка "Шаблоны протоколов" — форматы ведения записи сессии
// (source_type: "protocol"). Перенесено сюда с отдельной страницы
// /note-templates, убранной из сайдбара — раньше это были 5
// захардкоженных карточек (SOAP/DAP/BIRP/EMDR/Семейная сессия) без
// связи с реальной базой знаний психолога и с иностранной
// терминологией. Теперь это обычные материалы psychologist'а, как и
// всё остальное в БЗ — можно добавлять свои варианты через "Материалы".
// ------------------------------------------------------------
function ProtocolTemplatesTab({
  items,
  loading,
  loadError,
}: {
  items: KnowledgeItem[];
  loading: boolean;
  loadError: string | null;
}) {
  const templates = items.filter(i => i.source_type === "protocol");
  const [viewing, setViewing] = useState<KnowledgeItem | null>(null);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#8C7355", fontSize: 13 }}>Загрузка…</div>;
  }
  if (loadError) {
    return (
      <div style={{ padding: 12, background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, color: "#B91C1C", fontSize: 13 }}>
        {loadError}
      </div>
    );
  }
  if (templates.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <ClipboardList size={48} style={{ color: "#8C7355", margin: "0 auto 16px" }} />
        <p style={{ color: "#6B6058", marginBottom: 0 }}>
          Пока нет шаблонов протоколов — добавьте свой во вкладке «Материалы» с типом «Шаблон протокола», либо используйте формат по умолчанию на странице сессии.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#6B6058", marginBottom: 16 }}>
        Форматы ведения записи сессии. Сама запись по конкретному клиенту заполняется на странице сессии.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
        {templates.map((tpl, idx) => (
          <motion.div key={tpl.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
            <Card hoverable onClick={() => setViewing(tpl)} style={{ cursor: "pointer" }}>
              <CardContent className="pt-6">
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                  {tpl.title || "Без названия"}
                </h4>
                <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 0, lineHeight: 1.5 }}>
                  {tpl.content.length > 220 ? `${tpl.content.slice(0, 220)}…` : tpl.content}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
      <ViewModal item={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

// ------------------------------------------------------------
// Вкладка "Материалы" — личная база знаний психолога, которую
// использует AI-ассистент для RAG-поиска (/api/knowledge). Единственное
// место, где можно добавить новый материал любого типа — он
// автоматически появится в соответствующей вкладке.
// ------------------------------------------------------------
function MaterialsTab({
  items,
  loading,
  loadError,
  reload,
}: {
  items: KnowledgeItem[];
  loading: boolean;
  loadError: string | null;
  reload: () => Promise<void>;
}) {
  const allMaterials = items.filter(i => i.source_type !== "technique" && i.source_type !== "homework" && i.source_type !== "test" && i.source_type !== "protocol");
  const { filtered, topics, approaches, topicFilter, setTopicFilter, approachFilter, setApproachFilter } =
    useTopicApproachFilter(allMaterials);
  const [viewing, setViewing] = useState<KnowledgeItem | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState<KnowledgeItem["source_type"]>("manual");
  const [approach, setApproach] = useState("");
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim()) {
      setSubmitError("Добавьте содержимое материала");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          content: content.trim(),
          source_type: sourceType,
          approach: approach.trim() || undefined,
          topic: topic.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data?.error ?? "Не удалось сохранить материал");
        return;
      }
      setTitle("");
      setContent("");
      setApproach("");
      setTopic("");
      setSourceType("manual");
      setShowForm(false);
      await reload();
    } catch {
      setSubmitError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/knowledge?id=${id}`, { method: "DELETE" });
      if (res.ok) await reload();
    } catch {
      // молча игнорируем — список просто не обновится, психолог увидит
      // элемент на месте и может попробовать удалить снова
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 12.5, color: "#6B6058", margin: 0 }}>
          Все ваши материалы — статьи и прочее. Ассистент использует их при ответах; техники, ДЗ, тесты и шаблоны протоколов также появляются в соответствующих вкладках.
        </p>
        <Button onClick={() => setShowForm(true)} variant="primary" size="sm">
          <Plus size={14} style={{ marginRight: 6 }} /> Добавить материал
        </Button>
      </div>

      {loadError && (
        <div style={{ padding: 12, background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, color: "#B91C1C", fontSize: 13, marginBottom: 16 }}>
          {loadError}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#8C7355", fontSize: 13 }}>Загрузка…</div>
      ) : allMaterials.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <BookOpen size={48} style={{ color: "#8C7355", margin: "0 auto 16px" }} />
          <p style={{ color: "#6B6058", marginBottom: 0 }}>
            Пока нет собственных материалов — добавьте первый, и ассистент сможет опираться на него в ответах.
          </p>
        </div>
      ) : (
        <>
          <FilterBar
            topics={topics} approaches={approaches}
            topicFilter={topicFilter} setTopicFilter={setTopicFilter}
            approachFilter={approachFilter} setApproachFilter={setApproachFilter}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map(item => (
              <Card key={item.id}>
                <CardContent className="pt-6" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div
                    onClick={() => setViewing(item)}
                    style={{
                      width: 36, height: 36, background: "#E8F2EF", borderRadius: 8,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer",
                    }}
                  >
                    <BookOpen size={16} style={{ color: "#2D6A5C" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setViewing(item)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>
                        {item.title || "Без названия"}
                      </span>
                      <Badge variant="muted">{SOURCE_TYPE_LABELS[item.source_type]}</Badge>
                      {item.approach && <Badge variant="muted">{approachLabel(item.approach)}</Badge>}
                      {item.topic && <Badge variant="muted">{item.topic}</Badge>}
                    </div>
                    <p style={{ fontSize: 12.5, color: "#6B6058", lineHeight: 1.5, margin: 0 }}>
                      {item.content.length > 200 ? `${item.content.slice(0, 200)}…` : item.content}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(item.id)}
                    title="Удалить материал"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355", padding: 4, flexShrink: 0 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <ViewModal item={viewing} onClose={() => setViewing(null)} />

      <AnimatePresence>
        {showForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !submitting && setShowForm(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }}
            />
            <div
              style={{
                position: "fixed", inset: 0, zIndex: 45,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 24, pointerEvents: "none",
              }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                style={{
                  background: "#FFFFFF", borderRadius: 16,
                  width: "90%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto",
                  boxShadow: "0 25px 80px rgba(0,0,0,0.2)",
                  pointerEvents: "auto",
                }}
              >
                <div style={{
                  padding: 24, borderBottom: "1px solid #E5DFD5",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>Новый материал</h3>
                  <button
                    onClick={() => !submitting && setShowForm(false)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355" }}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058", display: "block", marginBottom: 6 }}>
                      Название (опционально)
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Например: Мой протокол первой сессии"
                      style={{
                        width: "100%", padding: "8px 12px", border: "1px solid #E5DFD5",
                        borderRadius: 8, fontSize: 13, color: "#1C1C1E", boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058", display: "block", marginBottom: 6 }}>
                        Тип материала
                      </label>
                      <select
                        value={sourceType}
                        onChange={e => setSourceType(e.target.value as KnowledgeItem["source_type"])}
                        style={{
                          width: "100%", padding: "8px 12px", border: "1px solid #E5DFD5",
                          borderRadius: 8, fontSize: 13, color: "#1C1C1E", boxSizing: "border-box",
                          background: "#fff",
                        }}
                      >
                        <option value="manual">Материал</option>
                        <option value="technique">Техника</option>
                        <option value="homework">Домашнее задание</option>
                        <option value="article">Статья</option>
                        <option value="protocol">Шаблон протокола</option>
                        <option value="test">Тест</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058", display: "block", marginBottom: 6 }}>
                        Подход (опционально)
                      </label>
                      <input
                        type="text"
                        value={approach}
                        onChange={e => setApproach(e.target.value)}
                        placeholder="Например: КПТ"
                        style={{
                          width: "100%", padding: "8px 12px", border: "1px solid #E5DFD5",
                          borderRadius: 8, fontSize: 13, color: "#1C1C1E", boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058", display: "block", marginBottom: 6 }}>
                      Тема / проблема (опционально)
                    </label>
                    <input
                      type="text"
                      value={topic}
                      onChange={e => setTopic(e.target.value)}
                      placeholder="Например: тревога, отношения, самооценка"
                      style={{
                        width: "100%", padding: "8px 12px", border: "1px solid #E5DFD5",
                        borderRadius: 8, fontSize: 13, color: "#1C1C1E", boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058", display: "block", marginBottom: 6 }}>
                      Содержание
                    </label>
                    <textarea
                      value={content}
                      onChange={e => setContent(e.target.value)}
                      rows={8}
                      placeholder={
                        sourceType === "homework"
                          ? "Готовый текст, который получит клиент — пишите как сообщение ему, а не описание техники…"
                          : "Вставьте текст материала…"
                      }
                      style={{
                        width: "100%", padding: "10px 12px", border: "1px solid #E5DFD5",
                        borderRadius: 8, fontSize: 13, color: "#1C1C1E", boxSizing: "border-box",
                        fontFamily: "var(--font-sans)", resize: "vertical",
                      }}
                    />
                  </div>

                  {submitError && <div style={{ fontSize: 12, color: "#B91C1C" }}>{submitError}</div>}

                  <Button size="md" className="w-full" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 size={15} style={{ marginRight: 8, animation: "knowledgeSpin 1s linear infinite" }} />
                        Создаём эмбеддинги…
                      </>
                    ) : (
                      "Сохранить материал"
                    )}
                  </Button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes knowledgeSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default function KnowledgePage() {
  const { items, loading, loadError, reload } = useKnowledgeItems();
  const [notification, setNotification] = useState<string | null>(null);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const tabItems = [
    {
      id: "techniques",
      label: "Техники",
      content: <TechniquesTab items={items} loading={loading} loadError={loadError} />,
    },
    {
      id: "templates",
      label: "Шаблоны ДЗ",
      content: <HomeworkTemplatesTab items={items} loading={loading} loadError={loadError} onNotify={notify} />,
    },
    {
      id: "tests",
      label: "Тесты",
      content: <TestsTab items={items} loading={loading} loadError={loadError} onNotify={notify} />,
    },
    {
      id: "protocols",
      label: "Шаблоны протоколов",
      content: <ProtocolTemplatesTab items={items} loading={loading} loadError={loadError} />,
    },
    {
      id: "materials",
      label: "Материалы",
      content: <MaterialsTab items={items} loading={loading} loadError={loadError} reload={reload} />,
    },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E" }}>База знаний</h1>
          <p style={{ fontSize: 14, color: "#6B6058", marginTop: 2 }}>
            Техники, шаблоны, тесты и материалы
          </p>
        </div>
      </div>

      <Tabs items={tabItems} defaultTab="techniques" />

      {/* Уведомление */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
              background: "#1BAF7A", color: "#fff", padding: "12px 20px",
              borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 60,
              boxShadow: "0 4px 12px rgba(27, 175, 122, 0.3)",
              maxWidth: 420, textAlign: "center",
            }}
          >
            {notification}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
