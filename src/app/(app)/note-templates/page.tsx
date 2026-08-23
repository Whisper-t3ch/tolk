"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClipboardList, X, ArrowRight, Star } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import { mockSOAP } from "@/lib/mock-data";

interface Template {
  id: string;
  name: string;
  fullName: string;
  description: string;
  fields: { label: string; hint: string }[];
  bestFor: string;
  isDefault?: boolean;
}

const TEMPLATES: Template[] = [
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
    isDefault: true,
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
  },
];

export default function NoteTemplatesPage() {
  const [selected, setSelected] = useState<Template | null>(null);
  const [defaultId, setDefaultId] = useState("soap");
  const [notification, setNotification] = useState<string | null>(null);

  const setAsDefault = (tpl: Template) => {
    setDefaultId(tpl.id);
    setSelected(null);
    setNotification(`«${tpl.name}» установлен шаблоном по умолчанию`);
    setTimeout(() => setNotification(null), 2500);
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.5px" }}>
          Шаблоны протоколов
        </h1>
        <p style={{ fontSize: 14, color: "#6B6058", marginTop: 6 }}>
          Выберите формат заметки — ассистент будет структурировать протокол сессии под него автоматически
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {TEMPLATES.map((tpl, i) => (
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
                <p style={{ fontSize: 11, color: "#8C7355", marginBottom: 10 }}>{tpl.fullName}</p>
                <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.5, marginBottom: 12 }}>
                  {tpl.description}
                </p>
                <div style={{ fontSize: 11, color: "#2D6A5C", fontWeight: 600 }}>
                  Подходит для: {tpl.bestFor}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

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
                    <p style={{ fontSize: 12, color: "#8C7355", margin: "4px 0 0" }}>{selected.fullName}</p>
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
