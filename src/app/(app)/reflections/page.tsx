"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, BookOpen, X } from "lucide-react";
import { Button, Card, CardContent, Input } from "@/components/ui";

interface Reflection {
  id: string;
  title: string;
  content: string;
  tags: string[];
  client_id: string | null;
  created_at: string;
  clients?: { name: string } | null;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" });
}

export default function ReflectionsPage() {
  const [entries, setEntries] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/reflections");
        const data = await res.json();
        if (!cancelled && res.ok) setEntries(data.reflections ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = entries.filter(e =>
    e.title.toLowerCase().includes(search.toLowerCase()) ||
    e.content.toLowerCase().includes(search.toLowerCase())
  );

  async function save() {
    if (!newTitle.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reflections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, content: newText }),
      });
      const data = await res.json();
      if (res.ok) {
        setEntries(prev => [data.reflection, ...prev]);
        setNewTitle("");
        setNewText("");
        setShowNew(false);
      } else {
        setError(data.error ?? "Не удалось сохранить запись");
      }
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
    await fetch(`/api/reflections/${id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E" }}>Дневник</h1>
          <p style={{ fontSize: 14, color: "#6B6058", marginTop: 2 }}>
            Наблюдения и инсайты
          </p>
        </div>
        <Button onClick={() => setShowNew(v => !v)} size="md">
          <Plus size={14} style={{ marginRight: 6 }} /> Новая запись
        </Button>
      </div>

      {/* Поиск */}
      <div style={{ marginBottom: 20 }}>
        <Input
          placeholder="Поиск записей..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full"
        />
      </div>

      {/* Форма новой записи */}
      <AnimatePresence>
        {showNew && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: "hidden", marginBottom: 16 }}
          >
            <Card className="border-2 border-[#2D6A5C]">
              <CardContent className="pt-6">
                {error && (
                  <p style={{ fontSize: 12.5, color: "#EF4444", marginBottom: 10 }}>{error}</p>
                )}
                <input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Заголовок записи..."
                  style={{
                    width: "100%", padding: "10px 14px",
                    border: "1px solid #E5DFD5",
                    borderRadius: 8, fontSize: 15, fontWeight: 500,
                    color: "#1C1C1E",
                    fontFamily: "var(--font-sans)",
                    marginBottom: 12,
                    boxSizing: "border-box",
                  }}
                />
                <textarea
                  value={newText}
                  onChange={e => setNewText(e.target.value)}
                  placeholder="Напишите вашу рефлексию..."
                  style={{
                    width: "100%", padding: "10px 14px",
                    border: "1px solid #E5DFD5",
                    borderRadius: 8, fontSize: 14,
                    color: "#1C1C1E",
                    fontFamily: "var(--font-sans)",
                    minHeight: 120,
                    resize: "none",
                    marginBottom: 12,
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={save} variant="primary" disabled={saving}>
                    {saving ? "Сохраняю..." : "Сохранить"}
                  </Button>
                  <Button onClick={() => setShowNew(false)} variant="outline">
                    Отмена
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Список записей */}
      {loading ? (
        <p style={{ fontSize: 13, color: "#8C7355" }}>Загружаю записи...</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#8C7355" }}>
          <BookOpen size={28} style={{ marginBottom: 10, opacity: 0.5 }} />
          <p style={{ fontSize: 13 }}>
            {entries.length === 0 ? "Записей пока нет — начните вести дневник" : "Ничего не найдено"}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <AnimatePresence>
            {filtered.map((entry, idx) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card
                  hoverable
                  className="cursor-pointer hover:bg-[#F5F3EF]"
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  <CardContent className="pt-6">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                      <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#1C1C1E", marginBottom: 4 }}>
                          {entry.title}
                        </h3>
                        <p style={{ fontSize: 13, color: "#6B6058", marginBottom: 8 }}>
                          {entry.content.length > 140 ? entry.content.slice(0, 140) + "..." : entry.content}
                        </p>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, color: "#8C7355" }}>
                            {formatDate(entry.created_at)}
                          </span>
                          {entry.clients?.name && (
                            <span style={{
                              fontSize: 11, color: "#1BAF7A",
                              background: "#E6F7F2",
                              padding: "2px 8px",
                              borderRadius: 4,
                            }}>
                              {entry.clients.name}
                            </span>
                          )}
                          {entry.tags.map((tag, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: 11, color: "#2D6A5C",
                                background: "#E8F2EF",
                                padding: "2px 8px",
                                borderRadius: 4,
                              }}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <AnimatePresence>
                          {expandedId === entry.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              style={{ overflow: "hidden" }}
                            >
                              <p style={{
                                fontSize: 13, color: "#1C1C1E", lineHeight: 1.6,
                                marginTop: 12, paddingTop: 12, borderTop: "1px solid #E5DFD5",
                                whiteSpace: "pre-wrap",
                              }}>
                                {entry.content || "Текст записи пуст."}
                              </p>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  remove(entry.id);
                                }}
                                style={{
                                  marginTop: 10, background: "none", border: "none",
                                  color: "#EF4444", fontSize: 12, cursor: "pointer",
                                  display: "flex", alignItems: "center", gap: 4, padding: 0,
                                }}
                              >
                                <X size={12} /> Удалить запись
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
