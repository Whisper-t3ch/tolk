"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Copy, Check, QrCode, X, Settings as SettingsIcon, Sparkles } from "lucide-react";
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
  const [showQr, setShowQr] = useState(false);
    const [notification, setNotification] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setSpecialty(profile.specialty);
      setBio(profile.bio ?? "");
    }
  }, [profile]);

  const plan = profile?.plan ?? { key: "", extra: 0, name: "—", assistantRequests: { used: 0, total: 1 } };
  const extraCredits = plan.extra ?? 0;
  const roomUrl = profile?.roomUrl ?? "";
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
    navigator.clipboard?.writeText(`https://${roomUrl}`);
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
              Ваша ссылка для клиентов
            </h3>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 16px",
              background: "#F5F3EF",
              border: "1px solid #E5DFD5",
              borderRadius: 10,
              marginBottom: 12,
            }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "#2D6A5C" }}>
                {roomUrl}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={copyLink} variant={copied ? "primary" : "secondary"} size="sm">
                {copied ? <><Check size={12} style={{ marginRight: 4 }} /> Скопировано</> : <><Copy size={12} style={{ marginRight: 4 }} /> Копировать</>}
              </Button>
              <Button onClick={() => setShowQr(true)} variant="outline" size="sm">
                <QrCode size={12} style={{ marginRight: 4 }} /> QR-код
              </Button>
            </div>
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

      {/* Модал QR-кода */}
      <AnimatePresence>
        {showQr && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowQr(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              style={{
                position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                background: "#FFFFFF", borderRadius: 16, width: "90%", maxWidth: 340,
                zIndex: 45, boxShadow: "0 25px 80px rgba(0,0,0,0.2)", padding: 24, textAlign: "center",
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setShowQr(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6F5A3F" }}>
                  <X size={18} />
                </button>
              </div>
              <div style={{
                width: 200, height: 200, margin: "0 auto 16px",
                background: "repeating-conic-gradient(#1C1C1E 0% 25%, #FFFFFF 0% 50%) 0 0 / 20px 20px",
                borderRadius: 8, border: "1px solid #E5DFD5",
              }} />
              <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 16 }}>
                Клиенты сканируют этот QR-код, чтобы сразу открыть {roomUrl}
              </p>
              <Button
                onClick={() => { notify("QR-код сохранён в загрузки"); setShowQr(false); }}
                variant="secondary" className="w-full"
              >
                Скачать PNG
              </Button>
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
