"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Copy, Check, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { useProfile } from "@/lib/ProfileContext";
import Avatar from "@/components/Avatar";
import PlanPickerModal from "@/components/PlanPickerModal";
import { Button, Card, CardContent, Input } from "@/components/ui";

export default function ProfilePage() {
  const { profile, updateProfile, refresh: refreshProfile } = useProfile();
  const [bio, setBio] = useState("");
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
    const [notification, setNotification] = useState<string | null>(null);

  const [tg, setTg] = useState<{ connected: boolean; username: string | null } | null>(null);
  const [tgBusy, setTgBusy] = useState(false);
  const loadTg = async () => {
    try {
      const res = await fetch("/api/notifications/telegram");
      if (res.ok) setTg(await res.json());
    } catch { /* не критично */ }
  };
  useEffect(() => { void loadTg(); }, []);
  async function connectTg() {
    setTgBusy(true);
    try {
      const res = await fetch("/api/notifications/telegram", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Не удалось создать ссылку");
      window.open(data.url, "_blank", "noopener");
      // Привязка происходит в Telegram по нажатию «Запустить» — опрашиваем статус.
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const st = await fetch("/api/notifications/telegram").then(r => r.json()).catch(() => null);
        if (st?.connected) { setTg(st); notify("Telegram подключён"); break; }
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setTgBusy(false);
    }
  }
  async function disconnectTg() {
    setTgBusy(true);
    await fetch("/api/notifications/telegram", { method: "DELETE" }).catch(() => null);
    await loadTg();
    setTgBusy(false);
  }

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setSpecialty(profile.specialty);
      setBio(profile.bio ?? "");
    }
  }, [profile]);

  const plan = profile?.plan ?? { key: "", extra: 0, name: "—", assistantRequests: { used: 0, total: 1 } };
  const extraCredits = plan.extra ?? 0;
  const bookingPath = profile?.bookingSlug ? `/book/${profile.bookingSlug}` : null;
  const bookingUrl = bookingPath && typeof window !== "undefined" ? `${window.location.origin}${bookingPath}` : bookingPath;
  const avatarInitials = profile?.avatarInitials ?? "…";
  const email = profile?.email ?? "";
  const memberSince = profile?.memberSince ?? "—";
  const totalRequests = plan.assistantRequests.total;
  const creditPct = totalRequests > 0 ? Math.round((plan.assistantRequests.used / totalRequests) * 100) : 0;

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  function copyLink() {
    if (bookingUrl) navigator.clipboard?.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function saveProfile() {
    setSaving(true);
    try {
      await updateProfile({ name, specialty, bio });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Не удалось сохранить профиль");
    } finally {
      setSaving(false);
    }
  }

  async function buyCredits() {
    try {
      const res = await fetch("/api/assistant/credits", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось начислить запросы");
      notify("Добавлено 100 запросов к лимиту");
      await refreshProfile();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Не удалось начислить запросы");
    }
  }

  // Фото: уменьшаем до 256×256 (JPEG) на клиенте и сохраняем как data URL.
  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const side = Math.min(bmp.width, bmp.height);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      await updateProfile({ avatarData: dataUrl });
      notify("Фото обновлено");
    } catch (e) {
      notify(e instanceof Error && e.message !== "canvas" ? e.message : "Не удалось загрузить фото");
    }
  }

  async function removePhoto() {
    try {
      await updateProfile({ avatarData: null });
      notify("Фото удалено");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Не удалось удалить фото");
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, padding: "0 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E" }}>Профиль</h1>
        <Link href="/settings" style={{ textDecoration: "none" }}>
          <Button variant="secondary" size="sm">
            <SettingsIcon size={13} style={{ marginRight: 6 }} /> Настройки
          </Button>
        </Link>
      </div>

      {/* Карточка психолога */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardContent className="pt-6">
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <Avatar src={profile?.avatarData} initials={avatarInitials} size={64} fontSize={22} />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: "none" }}
                  onChange={e => { onPickPhoto(e.target.files?.[0]); e.target.value = ""; }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#2D6A5C" }}
                >
                  {profile?.avatarData ? "Заменить фото" : "Добавить фото"}
                </button>
                {profile?.avatarData && (
                  <button
                    type="button"
                    onClick={removePhoto}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#6B6058" }}
                  >
                    Удалить
                  </button>
                )}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#1C1C1E" }}>{name}</div>
                <div style={{ fontSize: 13, color: "#6B6058", marginTop: 2 }}>{email}</div>
                <div style={{ fontSize: 12, color: "#6F5A3F", marginTop: 2 }}>С нами с {memberSince}</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Input
                label="Имя"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <Input
                label="Специальность"
                value={specialty}
                onChange={e => setSpecialty(e.target.value)}
              />
              <label style={{ display: "block" }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1C1C1E", marginBottom: 6 }}>О себе</span>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value.slice(0, 1000))}
                  rows={4}
                  placeholder="Коротко о вашем подходе и опыте — это ваша визитка"
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: 14, color: "#1C1C1E",
                    background: "#FFFFFF", border: "1px solid #D9D2C5", borderRadius: 8, resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              </label>
              <Button onClick={saveProfile} variant="primary" disabled={saving}>
                {saved ? <><Check size={14} style={{ marginRight: 6 }} /> Сохранено</> : saving ? "Сохраняю..." : "Сохранить"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Ссылка для клиентов */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
        <Card>
          <CardContent className="pt-6">
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: "#1C1C1E" }}>
              Ссылка для онлайн-записи клиентов
            </h3>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 16px",
              background: "#F5F3EF",
              border: "1px solid #E5DFD5",
              borderRadius: 10,
              marginBottom: 12,
            }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "#2D6A5C", wordBreak: "break-all" }}>
                {bookingUrl ?? "Онлайн-запись выключена — включите её в «Настройки → Публичная запись»"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={copyLink} variant={copied ? "primary" : "secondary"} size="sm" disabled={!bookingUrl}>
                {copied ? <><Check size={12} style={{ marginRight: 4 }} /> Скопировано</> : <><Copy size={12} style={{ marginRight: 4 }} /> Копировать</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Telegram-уведомления */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.09 }}>
        <Card>
          <CardContent className="pt-6">
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "#1C1C1E" }}>Telegram-уведомления</h3>
            <p style={{ fontSize: 13, color: "#6B6058", marginBottom: 14 }}>
              Новые записи клиентов и ответы поддержки — сразу в Telegram, без захода в кабинет.
            </p>
            {tg?.connected ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#166534" }}>✓ Подключено{tg.username ? ` (@${tg.username})` : ""}</span>
                <Button onClick={disconnectTg} variant="secondary" size="sm" disabled={tgBusy}>Отключить</Button>
              </div>
            ) : (
              <Button onClick={connectTg} variant="primary" size="sm" disabled={tgBusy}>
                {tgBusy ? "Ждём подтверждения в Telegram…" : "Подключить Telegram"}
              </Button>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Тариф и запросы к ассистенту */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <Card>
          <CardContent className="pt-6">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#1C1C1E", margin: 0 }}>
                Тариф «{plan.name}»
              </h3>
              <Link href="/settings#billing" style={{ fontSize: 12, color: "#2D6A5C", fontWeight: 600, textDecoration: "none" }}>
                Управлять тарифом
              </Link>
            </div>
            <p style={{ fontSize: 13, color: "#6B6058", marginBottom: 16 }}>
              Бета-тестирование — тариф и оплата пока не подключены
            </p>
            <div style={{
              padding: 12,
              background: "#F5F3EF",
              borderRadius: 8,
              marginBottom: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <Sparkles size={13} style={{ color: "#2D6A5C" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>
                  Запросы к ассистенту
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: "#6B6058" }}>
                  {plan.assistantRequests.used} / {totalRequests}
                  {extraCredits > 0 && <span style={{ color: "#157347" }}> (+{extraCredits})</span>}
                </span>
                <span style={{ color: "#2D6A5C", fontWeight: 600 }}>{creditPct}%</span>
              </div>
              <div style={{
                height: 6,
                background: "rgba(79, 126, 255, 0.1)",
                borderRadius: 4,
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${creditPct}%`,
                  height: "100%",
                  background: "#2D6A5C",
                  borderRadius: 4,
                  transition: "width 0.3s ease",
                }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={buyCredits} variant="primary" className="w-full">
                Докупить +100 за 99 ₽
              </Button>
              <Button onClick={() => setShowPlanPicker(true)} variant="secondary" className="w-full">
                Сменить тариф
              </Button>
            </div>
            {showPlanPicker && (
              <PlanPickerModal
                currentKey={plan.key}
                onClose={() => setShowPlanPicker(false)}
                onChanged={async label => {
                  setShowPlanPicker(false);
                  notify(`Тариф изменён: «${label}»`);
                  await refreshProfile();
                }}
              />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Уведомление */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            style={{
              position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
              background: "#157347", color: "#fff", padding: "12px 20px",
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
