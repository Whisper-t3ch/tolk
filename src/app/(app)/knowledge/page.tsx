"use client";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, BookOpen, Trash2, X, Loader2 } from "lucide-react";
import { knowledgeTechniques } from "@/lib/mock-data";
import { Button, Card, CardContent, Badge, Tabs } from "@/components/ui";

const HW_TEMPLATES = [
  {
    id: "hw1",
    title: "Дневник ситуаций ABC",
    description: "Структурированный дневник: Activating event → Beliefs → Consequences. Помогает клиенту отследить связь между мыслями и эмоциями.",
    tags: ["КПТ", "домашние задания", "мониторинг"],
  },
  {
    id: "hw2",
    title: "Поведенческий эксперимент",
    description: "Проверка убеждений через действие. Клиент тестирует гипотезу в реальной жизни и собирает доказательства.",
    tags: ["КПТ", "техники", "убеждения"],
  },
  {
    id: "hw3",
    title: "Техника 5-4-3-2-1 (grounding)",
    description: "Заземление: назови 5 вещей, которые видишь, 4 — трогаешь, 3 — слышишь, 2 — обоняешь, 1 — пробуешь. Для тревоги и паники.",
    tags: ["телесные практики", "тревога", "стресс"],
  },
];

// ------------------------------------------------------------
// Вкладка "Материалы" — личная база знаний психолога, которую
// использует AI-ассистент для RAG-поиска (/api/knowledge). Раньше
// здесь была заглушка "в разработке" — теперь реальная загрузка
// с созданием эмбеддингов через YandexGPT.
// ------------------------------------------------------------
interface KnowledgeItem {
  id: string;
  title: string | null;
  content: string;
  source_type: "technique" | "article" | "protocol" | "manual";
  approach: string | null;
  created_at: string;
}

const SOURCE_TYPE_LABELS: Record<KnowledgeItem["source_type"], string> = {
  technique: "Техника",
  article: "Статья",
  protocol: "Протокол",
  manual: "Материал",
};

function MaterialsTab() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState<KnowledgeItem["source_type"]>("manual");
  const [approach, setApproach] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      await loadItems();
    } catch {
      setSubmitError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      const res = await fetch(`/api/knowledge?id=${id}`, { method: "DELETE" });
      if (!res.ok) await loadItems();
    } catch {
      await loadItems();
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, color: "#6B6058", margin: 0 }}>
          Личные материалы — статьи, протоколы, заметки. Ассистент использует их при ответах.
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
      ) : items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <BookOpen size={48} style={{ color: "#8C7355", margin: "0 auto 16px" }} />
          <p style={{ color: "#6B6058", marginBottom: 0 }}>
            Пока нет собственных материалов — добавьте первый, и ассистент сможет опираться на него в ответах.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map(item => (
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
                      placeholder="Вставьте текст материала…"
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
  const [detail, setDetail] = useState<{ title: string; description: string; tags: string[] } | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  const tabItems = [
    {
      id: "techniques",
      label: "Техники",
      content: (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
          {knowledgeTechniques.map((tech, idx) => (
            <motion.div
              key={tech.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card hoverable>
                <CardContent className="pt-6">
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                    {tech.title}
                  </h4>
                  <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 12 }}>
                    {tech.description}
                  </p>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                    {tech.tags.map((tag, i) => (
                      <Badge key={i} variant="muted">{tag}</Badge>
                    ))}
                  </div>
                  <Button onClick={() => setDetail(tech)} variant="secondary" size="sm" className="w-full">
                    Подробнее
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ),
    },
    {
      id: "templates",
      label: "Шаблоны ДЗ",
      content: (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
          {HW_TEMPLATES.map((template, idx) => (
            <motion.div
              key={template.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card hoverable>
                <CardContent className="pt-6">
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>
                    {template.title}
                  </h4>
                  <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 12 }}>
                    {template.description}
                  </p>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                    {template.tags.map((tag, i) => (
                      <Badge key={i} variant="muted">{tag}</Badge>
                    ))}
                  </div>
                  <Button onClick={() => notify(`Шаблон «${template.title}» добавлен в домашнее задание клиента`)} variant="secondary" size="sm" className="w-full">
                    Использовать
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ),
    },
    {
      id: "materials",
      label: "Материалы",
      content: <MaterialsTab />,
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
        <Button onClick={() => notify("Добавление собственных техник появится в одном из ближайших обновлений")} size="md">
          <Plus size={14} style={{ marginRight: 6 }} /> Добавить
        </Button>
      </div>

      <Tabs items={tabItems} defaultTab="techniques" />

      {/* Модал деталей техники */}
      <AnimatePresence>
        {detail && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetail(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{
                position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                background: "#FFFFFF", borderRadius: 16, width: "90%", maxWidth: 480,
                zIndex: 45, boxShadow: "0 25px 80px rgba(0,0,0,0.2)", padding: 24,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", marginBottom: 10 }}>{detail.title}</h3>
              <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, marginBottom: 14 }}>{detail.description}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                {detail.tags.map((tag, i) => <Badge key={i} variant="muted">{tag}</Badge>)}
              </div>
              <Button onClick={() => setDetail(null)} variant="secondary" className="w-full">Закрыть</Button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
            }}
          >
            {notification}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
