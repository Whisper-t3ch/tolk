"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClipboardList, X, ArrowRight, Star, Plus } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import { mockSOAP } from "@/lib/mock-data";

interface Template {
  id: string;
  name: string;
  fullName: string;
  description: string;
  fields: { label: string; hint: string }[];
  bestFor: string;
  isBuiltin?: boolean;
}

const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "soap",
    name: "SOAP",
    fullName: "Subjective, Objective, Assessment, Plan",
    description: "Классический медицинский формат протокола. Разделяет субъективные жалобы клиента, объективные наблюдения, оценку динамики и план дальнейшей работы.",
    fields: [
      { label: "S — Subjective", hint: "Что говорит клиент: жалобы, ощущения, цитаты" },
      { label: "O — Objective", hint: "Наблюдения психолога: поведение, аффект, тесты" },
      { label: "A — Assessment", hint: "Клиническая оценка динамики и гипотез" },
      { label: "P — Plan", hint: "План на следующие сессии, домашние задания" },
    ],
    bestFor: "КПТ, общая практика, работа со страховыми",
    isBuiltin: true,
  },
  {
    id: "dap",
    name: "DAP",
    fullName: "Data, Assessment, Plan",
    description: "Упрощённая версия SOAP — объединяет субъективные и объективные данные в один раздел. Быстрее заполнять.",
    fields: [
      { label: "D — Data", hint: "Что происходило на сессии: слова клиента + наблюдения" },
      { label: "A — Assessment", hint: "Интерпретация, клинические выводы" },
      { label: "P — Plan", hint: "Следующие шаги" },
    ],
    bestFor: "Короткие сессии, высокая нагрузка по клиентам",
    isBuiltin: true,
  },
  {
    id: "birp",
    name: "BIRP",
    fullName: "Behavior, Intervention, Response, Plan",
    description: "Формат, ориентированный на конкретные интервенции и реакцию клиента на них. Часто используется в поведенческой терапии.",
    fields: [
      { label: "B — Behavior", hint: "Наблюдаемое поведение и заявленные проблемы" },
      { label: "I — Intervention", hint: "Какие техники применялись на сессии" },
      { label: "R — Response", hint: "Как клиент отреагировал на интервенцию" },
      { label: "P — Plan", hint: "Дальнейшие шаги" },
    ],
    bestFor: "Поведенческая терапия, работа с зависимостями",
    isBuiltin: true,
  },
  {
    id: "emdr",
    name: "EMDR",
    fullName: "Протокол EMDR-сессии",
    description: "Структура для документирования сессий десенсибилизации и переработки движением глаз: фаза, целевое воспоминание, уровень дистресса до/после.",
    fields: [
      { label: "Фаза протокола", hint: "Подготовка / Десенсибилизация / Инсталляция / Сканирование тела" },
      { label: "Целевое воспоминание", hint: "Образ, негативное убеждение, эмоция, телесный отклик" },
      { label: "SUD до/после", hint: "Субъективный уровень дистресса (0–10) в начале и конце" },
      { label: "VOC", hint: "Валидность положительного убеждения (1–7)" },
    ],
    bestFor: "EMDR-терапия, травма-фокусированная работа",
    isBuiltin: true,
  },
  {
    id: "family",
    name: "Семейная сессия",
    fullName: "Протокол работы с парой/семьёй",
    description: "Формат для фиксации динамики между несколькими участниками сессии, а не только с одним клиентом.",
    fields: [
      { label: "Участники", hint: "Кто присутствовал на сессии" },
      { label: "Динамика взаимодействия", hint: "Паттерны общения, конфликтные зоны" },
      { label: "Индивидуальные позиции", hint: "Точка зрения каждого участника" },
      { label: "План", hint: "Согласованные договорённости, следующие шаги" },
    ],
    bestFor: "Семейная и парная терапия",
    isBuiltin: true,
  },
];

interface ApiTemplate {
  id: string;
  name: string;
  full_name: string;
  description: string;
  fields: { label: string; hint: string }[];
  best_for: string;
}

export default function NoteTemplatesPage() {
  const [customTemplates, setCustomTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Template | null>(null);
  const [defaultId, setDefaultId] = useState("soap");
  const [notification, setNotification] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newBestFor, setNewBestFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/note-templates");
        const data = await res.json();
        if (!cancelled && res.ok) {
          const mapped: Template[] = (data.templates ?? []).map((t: ApiTemplate) => ({
            id: t.id,
            name: t.name,
            fullName: t.full_name,
            description: t.description,
            fields: t.fields ?? [],
            bestFor: t.best_for,
          }));
          setCustomTemplates(mapped);
          setDefaultId(data.default_template_id ?? "soap");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const templates = [...BUILTIN_TEMPLATES, ...customTemplates];

  const setAsDefault = async (tpl: Template) => {
    setDefaultId(tpl.id);
    setSelected(null);
    setNotification(`«${tpl.name}» установлен шаблоном по умолчанию`);
    setTimeout(() => setNotification(null), 2500);
    await fetch("/api/note-templates/default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: tpl.id }),
    }).catch(() => {});
  };

  async function createTemplate() {
    if (!newName.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/note-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          description: newDescription,
          best_for: newBestFor,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCustomTemplates(prev => [
          {
            id: data.template.id,
            name: data.template.name,
            fullName: data.template.full_name,
            description: data.template.description,
            fields: data.template.fields ?? [],
            bestFor: data.template.best_for,
          },
          ...prev,
        ]);
        setNewName("");
        setNewDescription("");
        setNewBestFor("");
        setShowNew(false);
      } else {
        setError(data.error ?? "Не удалось создать шаблон");
      }
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(id: string) {
    setCustomTemplates(prev => prev.filter(t => t.id !== id));
    setSelected(null);
    await fetch(`/api/note-templates/${id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.5px" }}>
            Шаблоны протоколов
          </h1>
          <p style={{ fontSize: 14, color: "#6B6058", marginTop: 6 }}>
            Выберите формат заметки — ассистент будет структурировать протокол сессии под него автоматически
          </p>
        </div>
        <Button onClick={() => setShowNew(v => !v)} size="md">
          <Plus size={14} style={{ marginRight: 6 }} /> Свой шаблон
        </Button>
      </div>

      <AnimatePresence>
        {showNew && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: "hidden", marginBottom: 20 }}
          >
            <Card className="border-2 border-[#2D6A5C]">
              <CardContent className="pt-6">
                {error && <p style={{ fontSize: 12.5, color: "#EF4444", marginBottom: 10 }}>{error}</p>}
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Название шаблона..."
                  style={{
                    width: "100%", padding: "10px 14px", border: "1px solid #E5DFD5",
                    borderRadius: 8, fontSize: 14, color: "#1C1C1E",
                    fontFamily: "var(--font-sans)", marginBottom: 10, boxSizing: "border-box",
                  }}
                />
                <textarea
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="Описание структуры протокола..."
                  style={{
                    width: "100%", padding: "10px 14px", border: "1px solid #E5DFD5",
                    borderRadius: 8, fontSize: 13, color: "#1C1C1E",
                    fontFamily: "var(--font-sans)", minHeight: 80, resize: "none",
                    marginBottom: 10, boxSizing: "border-box",
                  }}
                />
                <input
                  value={newBestFor}
                  onChange={e => setNewBestFor(e.target.value)}
                  placeholder="Подходит для... (например: краткосрочная терапия)"
                  style={{
                    width: "100%", padding: "10px 14px", border: "1px solid #E5DFD5",
                    borderRadius: 8, fontSize: 13, color: "#1C1C1E",
                    fontFamily: "var(--font-sans)", marginBottom: 12, boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={createTemplate} variant="primary" disabled={saving}>
                    {saving ? "Сохраняю..." : "Создать"}
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

      {loading ? (
        <p style={{ fontSize: 13, color: "#8C7355" }}>Загружаю шаблоны...</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          {templates.map((tpl, i) => (
            <motion.div
              key={tpl.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card>
                <CardContent
                  className="pt-6"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected(tpl)}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{
                      width: 40, height: 40, background: "#E8F2EF", borderRadius: 10,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <ClipboardList size={18} style={{ color: "#2D6A5C" }} />
                    </div>
                    {defaultId === tpl.id && (
                      <span style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 8px", background: "#FEF3C7", color: "#F59E0B",
                        borderRadius: 20, fontSize: 10, fontWeight: 700,
                      }}>
                        <Star size={10} fill="#F59E0B" /> По умолчанию
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>
                    {tpl.name}
                  </h3>
                  <p style={{ fontSize: 11, color: "#8C7355", marginBottom: 10 }}>
                    {tpl.fullName || (tpl.isBuiltin ? "" : "Свой шаблон")}
                  </p>
                  <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.5, marginBottom: 12 }}>
                    {tpl.description}
                  </p>
                  {tpl.bestFor && (
                    <div style={{ fontSize: 11, color: "#2D6A5C", fontWeight: 600 }}>
                      Подходит для: {tpl.bestFor}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Модал детали шаблона */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
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
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>{selected.name}</h2>
                    {selected.fullName && <p style={{ fontSize: 12, color: "#8C7355", margin: "4px 0 0" }}>{selected.fullName}</p>}
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355" }}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div style={{ padding: 24 }}>
                  <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, marginBottom: 20 }}>
                    {selected.description}
                  </p>

                  {selected.fields.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 12, fontWeight: 700, color: "#8C7355", textTransform: "uppercase", marginBottom: 10 }}>
                        Структура протокола
                      </h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                        {selected.fields.map((field, i) => (
                          <div key={i} style={{ padding: "10px 12px", background: "#F5F3EF", borderRadius: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E", marginBottom: 2 }}>
                              {field.label}
                            </div>
                            <div style={{ fontSize: 12, color: "#6B6058" }}>{field.hint}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {selected.id === "soap" && (
                    <div style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 700, color: "#8C7355", textTransform: "uppercase", marginBottom: 10 }}>
                        Пример готового протокола
                      </h3>
                      <div style={{ padding: 12, background: "#E8F2EF", borderRadius: 8, fontSize: 12, color: "#1C1C1E", lineHeight: 1.5 }}>
                        <strong>{mockSOAP.clientName}</strong>, сессия №{mockSOAP.sessionNumber} · {mockSOAP.date}
                        <p style={{ margin: "8px 0 0" }}>{mockSOAP.s.slice(0, 140)}…</p>
                      </div>
                    </div>
                  )}

                  <Button size="md" className="w-full" onClick={() => setAsDefault(selected)} disabled={defaultId === selected.id}>
                    {defaultId === selected.id ? "Уже используется по умолчанию" : "Сделать шаблоном по умолчанию"}
                    {defaultId !== selected.id && <ArrowRight size={15} style={{ marginLeft: 8 }} />}
                  </Button>

                  {!selected.isBuiltin && (
                    <button
                      onClick={() => removeTemplate(selected.id)}
                      style={{
                        marginTop: 12, background: "none", border: "none",
                        color: "#EF4444", fontSize: 12, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 4, padding: 0,
                      }}
                    >
                      <X size={12} /> Удалить шаблон
                    </button>
                  )}
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

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
