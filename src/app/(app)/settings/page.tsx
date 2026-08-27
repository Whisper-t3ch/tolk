"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  User, Bell, Plug, CreditCard, Palette, ShieldCheck, AlertTriangle,
  ExternalLink, Sun, Moon, Monitor,
} from "lucide-react";
import { currentPsychologist } from "@/lib/mock-data";
import { Button, Card, CardContent, Badge } from "@/components/ui";

const SECTIONS = [
  { id: "notifications", label: "Уведомления", icon: Bell },
  { id: "integrations",  label: "Интеграции",  icon: Plug },
  { id: "billing",       label: "Тариф и оплата", icon: CreditCard },
  { id: "appearance",    label: "Внешний вид", icon: Palette },
  { id: "privacy",       label: "Конфиденциальность", icon: ShieldCheck },
  { id: "danger",        label: "Опасные действия", icon: AlertTriangle },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("notifications");
  const [notifications, setNotifications] = useState(currentPsychologist.notifications);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light");
  const [extraCredits, setExtraCredits] = useState(0);
  const [notification, setNotification] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  // Интеграции — реальные данные из /api/integrations, а не моки.
  interface Integration {
    platform: "telegram" | "vk";
    bot_username: string | null;
    status: "disconnected" | "connected" | "error";
    last_error: string | null;
  }
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [showTelegramForm, setShowTelegramForm] = useState(false);
  const [showVkForm, setShowVkForm] = useState(false);
  const [telegramTokenInput, setTelegramTokenInput] = useState("");
  const [vkTokenInput, setVkTokenInput] = useState("");
  const [vkGroupIdInput, setVkGroupIdInput] = useState("");
  const [vkConfirmationInput, setVkConfirmationInput] = useState("");
  const [integrationSubmitting, setIntegrationSubmitting] = useState(false);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [vkSetupInfo, setVkSetupInfo] = useState<{ callback_url: string; secret_key: string } | null>(null);

  const loadIntegrations = async () => {
    try {
      const res = await fetch("/api/integrations");
      const data = await res.json();
      if (res.ok) setIntegrations(data.integrations ?? []);
    } finally {
      setIntegrationsLoading(false);
    }
  };

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (SECTIONS.some(s => s.id === hash)) {
      setActiveSection(hash as SectionId);
    }
    loadIntegrations();
  }, []);

  const telegramIntegration = integrations.find(i => i.platform === "telegram");
  const vkIntegration = integrations.find(i => i.platform === "vk");

  const connectTelegram = async () => {
    if (!telegramTokenInput.trim()) return;
    setIntegrationSubmitting(true);
    setIntegrationError(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "telegram", bot_token: telegramTokenInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntegrationError(data.error ?? "Не удалось подключить бота");
        return;
      }
      notify(`Telegram-бот @${data.integration.bot_username} подключён`);
      setShowTelegramForm(false);
      setTelegramTokenInput("");
      await loadIntegrations();
    } catch {
      setIntegrationError("Не удалось связаться с сервером");
    } finally {
      setIntegrationSubmitting(false);
    }
  };

  const connectVk = async () => {
    if (!vkTokenInput.trim() || !vkGroupIdInput.trim() || !vkConfirmationInput.trim()) return;
    setIntegrationSubmitting(true);
    setIntegrationError(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "vk",
          bot_token: vkTokenInput.trim(),
          vk_group_id: vkGroupIdInput.trim(),
          confirmation_code: vkConfirmationInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntegrationError(data.error ?? "Не удалось подключить сообщество");
        return;
      }
      notify(`Сообщество «${data.integration.bot_username}» подключено`);
      if (data.setup_instructions?.callback_url) {
        setVkSetupInfo(data.setup_instructions);
      } else {
        setShowVkForm(false);
      }
      setVkTokenInput("");
      setVkGroupIdInput("");
      setVkConfirmationInput("");
      await loadIntegrations();
    } catch {
      setIntegrationError("Не удалось связаться с сервером");
    } finally {
      setIntegrationSubmitting(false);
    }
  };

  const disconnectIntegration = async (platform: "telegram" | "vk") => {
    await fetch(`/api/integrations?platform=${platform}`, { method: "DELETE" });
    notify(platform === "telegram" ? "Telegram отключён" : "ВКонтакте отключён");
    await loadIntegrations();
  };

  const { plan } = currentPsychologist;
  const totalRequests = plan.assistantRequests.total + extraCredits;
  const creditPct = Math.round((plan.assistantRequests.used / totalRequests) * 100);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
  };

  function buyCredits() {
    setExtraCredits(prev => prev + 100);
    notify("Добавлено 100 запросов к лимиту тарифа");
  }

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button
      onClick={onChange}
      style={{
        width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
        background: checked ? "#2D6A5C" : "#E5DFD5", position: "relative", transition: "background 0.2s", flexShrink: 0,
      }}
    >
      <motion.div
        animate={{ x: checked ? 20 : 2 }}
        transition={{ duration: 0.15 }}
        style={{
          width: 18, height: 18, borderRadius: "50%", background: "#FFFFFF",
          position: "absolute", top: 2, boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E", marginBottom: 20 }}>Настройки</h1>

      <div style={{ display: "flex", gap: 24 }}>
        {/* Боковая навигация настроек */}
        <div style={{ flex: "0 0 200px", display: "flex", flexDirection: "column", gap: 4 }}>
          <Link href="/profile" style={{ textDecoration: "none" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
              borderRadius: 8, color: "#6B6058", fontSize: 13, fontWeight: 600,
              marginBottom: 8, border: "1px solid #E5DFD5",
            }}>
              <User size={15} /> Профиль
              <ExternalLink size={12} style={{ marginLeft: "auto", opacity: 0.5 }} />
            </div>
          </Link>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left",
                background: activeSection === id ? "#E8F2EF" : "transparent",
                color: activeSection === id ? "#2D6A5C" : id === "danger" ? "#EF4444" : "#6B6058",
                fontSize: 13, fontWeight: activeSection === id ? 700 : 600,
                fontFamily: "var(--font-sans)",
              }}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {/* Контент раздела */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {activeSection === "notifications" && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>Уведомления</h3>
                    <p style={{ fontSize: 13, color: "#8C7355", marginBottom: 20 }}>Что присылать вам в приложение и на почту</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {[
                        { key: "sessionReminders" as const, label: "Напоминания о сессиях", desc: "За 15 минут до начала" },
                        { key: "clientMessages" as const, label: "Сообщения от клиентов", desc: "Новые сообщения в чате" },
                        { key: "homeworkUpdates" as const, label: "Выполнение домашних заданий", desc: "Когда клиент отмечает ДЗ выполненным" },
                        { key: "productNews" as const, label: "Новости продукта", desc: "Обновления и новые функции ТОЛК" },
                      ].map(item => (
                        <div key={item.key} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "12px 0", borderBottom: "1px solid #F5F3EF",
                        }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{item.label}</div>
                            <div style={{ fontSize: 12, color: "#8C7355" }}>{item.desc}</div>
                          </div>
                          <Toggle checked={notifications[item.key]} onChange={() => toggleNotification(item.key)} />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeSection === "integrations" && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>Интеграции</h3>
                    <p style={{ fontSize: 13, color: "#8C7355", marginBottom: 20 }}>Подключите каналы связи с клиентами — сообщения и домашние задания будут приходить прямо в мессенджер</p>

                    {integrationsLoading ? (
                      <p style={{ fontSize: 13, color: "#8C7355" }}>Загрузка…</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* Telegram */}
                        <div style={{ padding: "14px", background: "#F5F3EF", borderRadius: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>Telegram</span>
                                {telegramIntegration?.status === "connected" && <Badge variant="success">Подключено</Badge>}
                                {telegramIntegration?.status === "error" && <Badge variant="danger">Ошибка</Badge>}
                              </div>
                              <div style={{ fontSize: 12, color: "#8C7355", marginTop: 2 }}>
                                {telegramIntegration?.status === "connected"
                                  ? `@${telegramIntegration.bot_username}`
                                  : telegramIntegration?.status === "error"
                                    ? telegramIntegration.last_error
                                    : "Бот не подключён"}
                              </div>
                            </div>
                            {telegramIntegration?.status === "connected" ? (
                              <Button variant="secondary" size="sm" onClick={() => disconnectIntegration("telegram")}>Отключить</Button>
                            ) : (
                              <Button variant="primary" size="sm" onClick={() => { setShowTelegramForm(v => !v); setIntegrationError(null); }}>
                                {showTelegramForm ? "Закрыть" : "Подключить"}
                              </Button>
                            )}
                          </div>

                          {showTelegramForm && telegramIntegration?.status !== "connected" && (
                            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #E5DFD5" }}>
                              <p style={{ fontSize: 12, color: "#6B6058", lineHeight: 1.6, marginBottom: 10 }}>
                                1. Откройте <strong>@BotFather</strong> в Telegram и создайте бота командой <code>/newbot</code>.<br />
                                2. Скопируйте выданный токен и вставьте его сюда.
                              </p>
                              <input
                                value={telegramTokenInput}
                                onChange={e => setTelegramTokenInput(e.target.value)}
                                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                                style={{
                                  width: "100%", padding: "8px 12px", border: "1px solid #E5DFD5",
                                  borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginBottom: 8,
                                  fontFamily: "monospace", color: "#1C1C1E", background: "#FFFFFF",
                                }}
                              />
                              {integrationError && <div style={{ fontSize: 12, color: "#B91C1C", marginBottom: 8 }}>{integrationError}</div>}
                              <Button size="sm" onClick={connectTelegram} disabled={integrationSubmitting || !telegramTokenInput.trim()}>
                                {integrationSubmitting ? "Проверяем…" : "Сохранить и подключить"}
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* VK */}
                        <div style={{ padding: "14px", background: "#F5F3EF", borderRadius: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>ВКонтакте</span>
                                {vkIntegration?.status === "connected" && <Badge variant="success">Подключено</Badge>}
                                {vkIntegration?.status === "error" && <Badge variant="danger">Ошибка</Badge>}
                              </div>
                              <div style={{ fontSize: 12, color: "#8C7355", marginTop: 2 }}>
                                {vkIntegration?.status === "connected"
                                  ? vkIntegration.bot_username
                                  : vkIntegration?.status === "error"
                                    ? vkIntegration.last_error
                                    : "Сообщество не подключено"}
                              </div>
                            </div>
                            {vkIntegration?.status === "connected" ? (
                              <Button variant="secondary" size="sm" onClick={() => disconnectIntegration("vk")}>Отключить</Button>
                            ) : (
                              <Button variant="primary" size="sm" onClick={() => { setShowVkForm(v => !v); setIntegrationError(null); }}>
                                {showVkForm ? "Закрыть" : "Подключить"}
                              </Button>
                            )}
                          </div>

                          {showVkForm && vkIntegration?.status !== "connected" && (
                            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #E5DFD5" }}>
                              <p style={{ fontSize: 12, color: "#6B6058", lineHeight: 1.6, marginBottom: 10 }}>
                                1. В настройках сообщества откройте <strong>Управление → Работа с API → Ключи доступа</strong> — создайте ключ сообщества.<br />
                                2. Там же включите <strong>Callback API</strong> — скопируйте код подтверждения (появится после включения).<br />
                                3. ID сообщества — число из ссылки на сообщество или из раздела «Управление».
                              </p>
                              <input
                                value={vkTokenInput}
                                onChange={e => setVkTokenInput(e.target.value)}
                                placeholder="Ключ доступа сообщества"
                                style={{ width: "100%", padding: "8px 12px", border: "1px solid #E5DFD5", borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginBottom: 8, fontFamily: "monospace", color: "#1C1C1E", background: "#FFFFFF" }}
                              />
                              <input
                                value={vkGroupIdInput}
                                onChange={e => setVkGroupIdInput(e.target.value)}
                                placeholder="ID сообщества"
                                style={{ width: "100%", padding: "8px 12px", border: "1px solid #E5DFD5", borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginBottom: 8, color: "#1C1C1E", background: "#FFFFFF" }}
                              />
                              <input
                                value={vkConfirmationInput}
                                onChange={e => setVkConfirmationInput(e.target.value)}
                                placeholder="Код подтверждения Callback API"
                                style={{ width: "100%", padding: "8px 12px", border: "1px solid #E5DFD5", borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginBottom: 8, fontFamily: "monospace", color: "#1C1C1E", background: "#FFFFFF" }}
                              />
                              {integrationError && <div style={{ fontSize: 12, color: "#B91C1C", marginBottom: 8 }}>{integrationError}</div>}
                              <Button
                                size="sm"
                                onClick={connectVk}
                                disabled={integrationSubmitting || !vkTokenInput.trim() || !vkGroupIdInput.trim() || !vkConfirmationInput.trim()}
                              >
                                {integrationSubmitting ? "Проверяем…" : "Сохранить и подключить"}
                              </Button>
                            </div>
                          )}

                          {vkSetupInfo && (
                            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #E5DFD5" }}>
                              <p style={{ fontSize: 12, color: "#6B6058", lineHeight: 1.6, marginBottom: 8 }}>
                                Осталось вставить эти значения в настройках Callback API сообщества:
                              </p>
                              <div style={{ fontSize: 11, fontFamily: "monospace", background: "#FFFFFF", padding: 10, borderRadius: 6, marginBottom: 6, wordBreak: "break-all" }}>
                                URL: {vkSetupInfo.callback_url}
                              </div>
                              <div style={{ fontSize: 11, fontFamily: "monospace", background: "#FFFFFF", padding: 10, borderRadius: 6, marginBottom: 8, wordBreak: "break-all" }}>
                                Секретный ключ: {vkSetupInfo.secret_key}
                              </div>
                              <Button size="sm" variant="secondary" onClick={() => { setVkSetupInfo(null); setShowVkForm(false); }}>Понятно</Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {activeSection === "billing" && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>Тариф «{plan.name}»</h3>
                    <p style={{ fontSize: 13, color: "#8C7355", marginBottom: 20 }}>
                      {plan.price} · до {plan.maxClients} клиентов · продление {plan.renewsOn}
                    </p>
                    <div style={{ padding: 12, background: "#F5F3EF", borderRadius: 8, marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                        <span style={{ color: "#6B6058" }}>
                          Запросы к ассистенту: {plan.assistantRequests.used} / {totalRequests}
                          {extraCredits > 0 && <span style={{ color: "#1BAF7A" }}> (+{extraCredits})</span>}
                        </span>
                        <span style={{ color: "#2D6A5C", fontWeight: 600 }}>{creditPct}%</span>
                      </div>
                      <div style={{ height: 6, background: "rgba(79,126,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${creditPct}%`, height: "100%", background: "#2D6A5C", borderRadius: 4 }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button onClick={buyCredits} variant="primary" className="w-full">
                        Докупить +100 за 99 ₽
                      </Button>
                      <Button onClick={() => notify("Список тарифов скоро будет доступен здесь")} variant="secondary" className="w-full">
                        Сменить тариф
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeSection === "appearance" && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>Внешний вид</h3>
                    <p style={{ fontSize: 13, color: "#8C7355", marginBottom: 20 }}>Тема интерфейса приложения</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                      {[
                        { id: "light" as const, label: "Светлая", icon: Sun },
                        { id: "dark" as const, label: "Тёмная", icon: Moon },
                        { id: "system" as const, label: "Как в системе", icon: Monitor },
                      ].map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => { setTheme(opt.id); notify(opt.id === "light" ? "Светлая тема применена" : "Эта тема появится в одном из ближайших обновлений"); }}
                          style={{
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                            padding: "18px 12px",
                            border: theme === opt.id ? "2px solid #2D6A5C" : "1px solid #E5DFD5",
                            borderRadius: 10, cursor: "pointer",
                            background: theme === opt.id ? "#E8F2EF" : "#FFFFFF",
                            fontFamily: "var(--font-sans)",
                          }}
                        >
                          <opt.icon size={20} style={{ color: theme === opt.id ? "#2D6A5C" : "#8C7355" }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: theme === opt.id ? "#2D6A5C" : "#6B6058" }}>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeSection === "privacy" && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>Конфиденциальность</h3>
                    <p style={{ fontSize: 13, color: "#8C7355", marginBottom: 20 }}>Как хранятся и защищаются данные ваших клиентов</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[
                        { title: "Серверы в РФ", desc: "Все данные клиентов хранятся на серверах, физически расположенных в России" },
                        { title: "Соответствие 152-ФЗ", desc: "Обработка персональных данных ведётся согласно требованиям закона о персональных данных" },
                        { title: "Шифрование", desc: "Данные передаются и хранятся в зашифрованном виде" },
                      ].map((item, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, padding: "12px 14px", background: "#F5F3EF", borderRadius: 10 }}>
                          <ShieldCheck size={16} style={{ color: "#1BAF7A", flexShrink: 0, marginTop: 1 }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{item.title}</div>
                            <div style={{ fontSize: 12, color: "#6B6058", marginTop: 2 }}>{item.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button
                      onClick={() => notify("Экспорт данных клиентов будет отправлен на почту")}
                      variant="secondary" className="w-full" style={{ marginTop: 16 }}
                    >
                      Экспортировать мои данные
                    </Button>
                  </CardContent>
                </Card>
              )}

              {activeSection === "danger" && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#EF4444", marginBottom: 4 }}>Опасные действия</h3>
                    <p style={{ fontSize: 13, color: "#8C7355", marginBottom: 20 }}>Эти действия необратимы</p>
                    <Button onClick={() => setShowDeleteConfirm(true)} variant="danger" className="w-full">
                      Удалить аккаунт
                    </Button>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Подтверждение удаления аккаунта */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setShowDeleteConfirm(false); setDeleteText(""); }}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              style={{
                position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                background: "#FFFFFF", borderRadius: 16, width: "90%", maxWidth: 420,
                zIndex: 45, boxShadow: "0 25px 80px rgba(0,0,0,0.2)", padding: 24,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <AlertTriangle size={20} style={{ color: "#EF4444" }} />
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>Удалить аккаунт?</h3>
              </div>
              <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.5, marginBottom: 16 }}>
                Это действие необратимо. Все клиенты, протоколы сессий и история будут удалены безвозвратно. Введите <strong>УДАЛИТЬ</strong>, чтобы подтвердить.
              </p>
              <input
                value={deleteText}
                onChange={e => setDeleteText(e.target.value)}
                placeholder="УДАЛИТЬ"
                style={{
                  width: "100%", padding: "8px 14px", border: "1px solid #E5DFD5", borderRadius: 8,
                  fontSize: 14, fontFamily: "var(--font-sans)", color: "#1C1C1E", boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <Button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteText(""); }}
                  variant="secondary" className="w-full"
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteText(""); notify("Заявка на удаление аккаунта принята"); }}
                  variant="danger" className="w-full"
                  disabled={deleteText !== "УДАЛИТЬ"}
                >
                  Удалить навсегда
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Уведомление */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
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
