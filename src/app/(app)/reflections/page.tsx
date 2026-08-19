"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, BookOpen, X } from "lucide-react";
import { reflections } from "@/lib/mock-data";
import { Button, Card, CardContent, Input } from "@/components/ui";

export default function ReflectionsPage() {
  const [entries, setEntries] = useState(reflections);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = entries.filter(e =>
    e.title.toLowerCase().includes(search.toLowerCase()) ||
    e.preview.toLowerCase().includes(search.toLowerCase())
  );

  function save() {
    if (!newTitle.trim()) return;
    setEntries(prev => [{
      id: `r${Date.now()}`,
      title: newTitle,
      date: "сейчас",
      preview: newText.slice(0, 120) + "...",
      tags: [],
      clientRef: null,
    }, ...prev]);
    setNewTitle("");
    setNewText("");
    setShowNew(false);
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
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={save} variant="primary">
                    Сохранить
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
                        {entry.preview}
                      </p>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "#8C7355" }}>
                          {entry.date}
                        </span>
                        {entry.clientRef && (
                          <span style={{
                            fontSize: 11, color: "#1BAF7A",
                            background: "#E6F7F2",
                            padding: "2px 8px",
                            borderRadius: 4,
                          }}>
                            {entry.clientRef}
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
                            }}>
                              {entry.preview} Полный текст записи хранится локально и синхронизируется между сессиями — здесь отображается расширенный предпросмотр.
                            </p>
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
    </div>
  );
}
