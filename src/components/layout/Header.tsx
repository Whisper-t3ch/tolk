"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Search, X, LogOut } from "lucide-react";
import { ToastContainer } from "@/components/ui";
import Avatar from "@/components/Avatar";
import { useProfile } from "@/lib/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { useClients } from "@/lib/ClientsContext";
import { ClientFace } from "@/components/Avatar";

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface Notif {
  id: string;
  text: string;
  at: string;
  upcoming?: boolean;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return d === 1 ? "вчера" : `${d} дн. назад`;
}


export default function Header() {
  const router = useRouter();
  const { clients } = useClients();
  const { profile } = useProfile();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [feed, setFeed] = useState<Notif[]>([]);
  const [lastReadAt, setLastReadAt] = useState<number>(0);
  const readKey = profile?.handle ? `tolk_notif_read_${profile.handle}` : null;

  useEffect(() => {
    if (!readKey) return;
    try {
      setLastReadAt(Number(localStorage.getItem(readKey) ?? 0));
    } catch {
      // storage недоступен — все уведомления считаются непрочитанными
    }
  }, [readKey]);

  const loadFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setFeed(data.items ?? []);
    } catch {
      // сеть недоступна — оставляем прежнюю ленту
    }
  }, []);

  useEffect(() => {
    loadFeed();
    const t = setInterval(loadFeed, 60_000);
    return () => clearInterval(t);
  }, [loadFeed]);

  const notifications = feed.map(n => ({ ...n, unread: new Date(n.at).getTime() > lastReadAt }));
  const unreadCount = notifications.filter(n => n.unread).length;

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const searchResults = search.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 5)
    : [];

  const markAllRead = () => {
    const ts = Date.now();
    setLastReadAt(ts);
    try {
      if (readKey) localStorage.setItem(readKey, String(ts));
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <header style={{
        height: 64,
        background: "#FFFFFF",
        borderBottom: "1px solid #E5DFD5",
        display: "flex", alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        position: "sticky", top: 0, zIndex: 40,
        gap: 24,
      }} className="tolk-app-header">
        <button
          type="button"
          className="tolk-burger"
          aria-label="Меню"
          onClick={() => window.dispatchEvent(new Event("tolk:toggle-menu"))}
          style={{ display: "none", alignItems: "center", justifyContent: "center", width: 40, height: 40, flexShrink: 0, background: "#F5F3EF", border: "1px solid #E5DFD5", borderRadius: 10, cursor: "pointer", color: "#1C1C1E" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        {/* Название платформы (заголовок раздела не дублируем — он уже есть в контенте страницы) */}
        <div className="tolk-header-brand" style={{ flexShrink: 0, minWidth: 140 }}>
          <span style={{
            fontSize: 15, fontWeight: 700, color: "#1C1C1E",
            display: "block",
          }}>ТОЛК</span>
          <span style={{
            fontSize: 11, color: "#6F5A3F",
            letterSpacing: "0.01em",
          }}>среда для психологов</span>
        </div>

        {/* Поиск по клиентам */}
        <div style={{ flex: 1, maxWidth: 420, position: "relative" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px",
            background: "#F5F3EF",
            border: searchFocused ? "1px solid #2D6A5C" : "1px solid #E5DFD5",
            borderRadius: 10,
            transition: "border-color 0.2s",
          }}>
            <Search size={15} style={{ color: "#6F5A3F", flexShrink: 0 }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Поиск по клиентам..."
              style={{
                border: "none", outline: "none", background: "none",
                fontSize: 13, color: "#1C1C1E", width: "100%",
                fontFamily: "var(--font-sans)",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#6F5A3F", display: "flex" }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <AnimatePresence>
            {searchFocused && searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                  background: "#FFFFFF", border: "1px solid #E5DFD5", borderRadius: 10,
                  boxShadow: "0 12px 32px rgba(15,22,41,0.12)", overflow: "hidden", zIndex: 50,
                }}
              >
                {searchResults.map(client => (
                  <button
                    key={client.id}
                    onClick={() => { router.push(`/clients/${client.id}`); setSearch(""); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", background: "none", border: "none",
                      cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#F5F3EF"}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    <div style={{
                      width: 28, height: 28, background: "#2D6A5C", borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0,
                    }}>
                      <ClientFace avatarData={client.avatarData} initials={client.initials} />
                    </div>
                    <span style={{ fontSize: 13, color: "#1C1C1E", fontWeight: 500 }}>{client.name}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {/* Уведомления */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowNotifications(v => !v)}
              style={{
                width: 36, height: 36,
                background: showNotifications ? "#E8F2EF" : "transparent",
                border: "1px solid #E5DFD5",
                borderRadius: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#6B6058",
                position: "relative",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span style={{
                  position: "absolute", top: 6, right: 6,
                  width: 7, height: 7,
                  background: "#EF4444",
                  borderRadius: "50%",
                  border: "1.5px solid #FFFFFF",
                }} />
              )}
            </button>

            <AnimatePresence>
              {showNotifications && (
                <>
                  <div
                    onClick={() => setShowNotifications(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 45 }}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    style={{
                      position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, maxWidth: "calc(100vw - 24px)",
                      background: "#FFFFFF", border: "1px solid #E5DFD5", borderRadius: 12,
                      boxShadow: "0 16px 40px rgba(15,22,41,0.15)", zIndex: 46, overflow: "hidden",
                    }}
                  >
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid #E5DFD5",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>Уведомления</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#2D6A5C", fontWeight: 600 }}
                        >
                          Прочитать все
                        </button>
                      )}
                    </div>
                    <div style={{ maxHeight: 300, overflowY: "auto" }}>
                      {notifications.length === 0 && (
                        <p style={{ padding: "20px 16px", margin: 0, fontSize: 12.5, color: "#4B443C", textAlign: "center" }}>
                          Пока нет уведомлений
                        </p>
                      )}
                      {notifications.map(n => (
                        <div
                          key={n.id}
                          style={{
                            padding: "12px 16px",
                            borderBottom: "1px solid #F5F3EF",
                            display: "flex", gap: 10, alignItems: "flex-start",
                            background: n.unread ? "#F8FAFF" : "transparent",
                          }}
                        >
                          {n.unread && (
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#2D6A5C", marginTop: 5, flexShrink: 0 }} />
                          )}
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 12, color: "#1C1C1E", margin: 0, lineHeight: 1.4 }}>{n.text}</p>
                            {!n.upcoming && <span style={{ fontSize: 11, color: "#6B6058" }}>{relTime(n.at)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Аватар психолога */}
          <Link href="/profile" title="Профиль" style={{ textDecoration: "none" }}>
            <Avatar src={profile?.avatarData} initials={profile?.avatarInitials ?? "…"} size={36} fontSize={12} border="2px solid #E8F2EF" />
          </Link>

          {/* Выход из аккаунта */}
          <button
            onClick={handleLogout}
            title="Выйти"
            style={{
              width: 36, height: 36,
              background: "transparent",
              border: "1px solid #E5DFD5",
              borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#6B6058",
              cursor: "pointer",
              transition: "all 0.2s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#FEE2E2"; e.currentTarget.style.color = "#EF4444"; e.currentTarget.style.borderColor = "#FCA5A5"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#6B6058"; e.currentTarget.style.borderColor = "#E5DFD5"; }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Toast уведомления */}
      <ToastContainer messages={toasts} onClose={removeToast} />
    </>
  );
}
