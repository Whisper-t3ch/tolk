"use client";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, BookOpen, Trash2, X, Loader2, Send } from "lucide-react";
import { Button, Card, CardContent, Badge, Tabs } from "@/components/ui";
import { useClients } from "@/lib/useClients";

// ------------------------------------------------------------
// Раздел "База знаний" — три вкладки поверх ОДНОЙ реальной таблицы
// knowledge_base (через /api/knowledge), различаемые по source_type:
//   - "Техники" — source_type: "technique" (описание техники для
//     психолога, справочный материал)
//   - "Шаблоны ДЗ" — source_type: "homework" (готовый текст сообщения,
//     который отправляется клиенту как есть, кнопка "Отправить" вызывает
//     POST /api/clients/[id]/homework с реальным выбором клиента)
//   - "Материалы" — все остальные типы (article/protocol/manual) плюс
//     форма добавления собственного материала
//
// Раньше "Техники" и "Шаблоны ДЗ" были захардкоженными моками
// (knowledgeTechniques из mock-data.ts, локальный HW_TEMPLATES) —
// ничего не сохраняли, не отправляли, в одном даже было вписано
// вымышленное имя клиента. Теперь все три вкладки читают один и тот же
// /api/knowledge и просто фильтруют результат на клиенте.
// ------------------------------------------------------------

interface KnowledgeItem {
  id: string;
  title: string | null;
  content: string;
  source_type: "technique" | "article" | "protocol" | "manual" | "homework";
  approach: string | null;
  created_at: string;
}

const SOURCE_TYPE_LABELS: Record<KnowledgeItem["source_type"], string> = {
  technique: "Техника",
  article: "Статья",
  protocol: "Протокол",
  manual: "Материал",
  homework: "Домашнее задание",
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
  const techniques = items.filter(i => i.source_type === "technique");

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
  if (techniques.length === 0) {
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
      {techniques.map((tech, idx) => (
        <motion.div key={tech.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
          <Card hoverable>
            <CardContent className="pt-6">
              <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                {tech.title || "Без названия"}
              </h4>
              <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 12, lineHeight: 1.5 }}>
                {tech.content.length > 220 ? `${tech.content.slice(0, 220)}…` : tech.content}
              </p>
              {tech.approach && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <Badge variant="muted">{tech.approach}</Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// Вкладка "Шаблоны ДЗ" — готовые тексты для отправки клиенту
// (source_type: "homework"). Кнопка "Отправить" открывает выбор
// реального клиента психолога и вызывает POST /api/clients/[id]/homework —
// в отличие от прошлой версии, это настоящая отправка (запись в messages,
// попытка доставки через мессенджер), а не toast-заглушка.
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
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                    {template.title || "Без названия"}
                  </h4>
                  <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 12, lineHeight: 1.5 }}>
                    {template.content.length > 200 ? `${template.content.slice(0, 200)}…` : template.content}
                  </p>
                  {template.approach && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                      <Badge variant="muted">{template.approach}</Badge>
                    </div>
                  )}
                  <Button onClick={() => openPicker(template)} variant="secondary" size="sm" className="w-full">
                    <Send size={13} style={{ marginRight: 6 }} /> Отправить клиенту
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

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
// Вкладка "Материалы" — личная база знаний психолога, которую
// использует AI-ассистент для RAG-поиска (/api/knowledge). Единственное
// место, где можно добавить новый материал любого типа, включая
// техники и домашние задания — они автоматически появятся в
// соответствующих вкладках.
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
  const materials = items.filter(i => i.source_type !== "technique" && i.source_type !== "homework");

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState<KnowledgeItem["source_type"]>("manual");
  const [approach, setApproach] = useState("");
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, color: "#6B6058", margin: 0 }}>
          Все ваши материалы — статьи, протоколы, техники, домашние задания. Ассистент использует их при ответах; техники и ДЗ также появляются в соответствующих вкладках.
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
      ) : materials.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <BookOpen size={48} style={{ color: "#8C7355", margin: "0 auto 16px" }} />
          <p style={{ color: "#6B6058", marginBottom: 0 }}>
            Пока нет собственных материалов — добавьте первый, и ассистент сможет опираться на него в ответах.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {materials.map(item => (
            <Card key={item.id}>
              <CardContent className="pt-6" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{
                  width: 36, height: 36, background: "#E8F2EF", borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <BookOpen size={16} style={{ color: "#2D6A5C" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>
                      {item.title || "Без названия"}
                    </span>
                    <Badge variant="muted">{SOURCE_TYPE_LABELS[item.source_type]}</Badge>
                    {item.approach && <Badge variant="muted">{item.approach}</Badge>}
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
      )}

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
                        <option value="protocol">Протокол</option>
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
            Техники, шаблоны и материалы
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
