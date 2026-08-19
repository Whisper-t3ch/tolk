"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, BookOpen } from "lucide-react";
import { knowledgeTechniques } from "@/lib/mock-data";
import { Button, Card, CardContent, Badge, Tabs } from "@/components/ui";

const TABS = ["Техники", "Шаблоны ДЗ", "Материалы"] as const;

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

export default function KnowledgePage() {
  const [tab, setTab] = useState<typeof TABS[number]>("Техники");
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
      content: (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <BookOpen size={48} style={{ color: "#8C7355", margin: "0 auto 16px" }} />
          <p style={{ color: "#6B6058", marginBottom: 16 }}>
            Материалы в разработке
          </p>
          <Button onClick={() => notify("Раздел «Материалы» скоро появится — мы уже над ним работаем")} variant="primary">
            <Plus size={14} style={{ marginRight: 6 }} /> Добавить материал
          </Button>
        </div>
      ),
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
