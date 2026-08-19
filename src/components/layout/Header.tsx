"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Search, X } from "lucide-react";
import { ToastContainer } from "@/components/ui";
import { currentPsychologist, clients } from "@/lib/mock-data";

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

const NOTIFICATIONS = [
  { id: "n1", text: "Анна Иванова заполнила домашнее задание", time: "12 мин назад", unread: true },
  { id: "n2", text: "Напоминание: сессия с Дмитрием Орловым через час", time: "1 ч назад", unread: true },
  { id: "n3", text: "Протокол сессии №7 готов к проверке", time: "вчера", unread: false },
];

export default function Header() {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState(NOTIFICATIONS);

  const unreadCount = notifications.filter(n => n.unread).length;

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const searchResults = search.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 5)
    : [];

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
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
      }}>
        {/* Название платформы (заголовок раздела не дублируем — он уже есть в контенте страницы) */}
        <div style={{ flexShrink: 0, minWidth: 140 }}>
          <span style={{
            fontSize: 15, fontWeight: 700, color: "#1C1C1E",
            display: "block",
          }}>ТОЛК</span>
          <span style={{
            fontSize: 11, color: "#8C7355",
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
            <Search size={15} style={{ color: "#8C7355", flexShrink: 0 }} />
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
                style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355", display: "flex" }}
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
                      {client.initials}
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
                      position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320,
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
                            <span style={{ fontSize: 11, color: "#8C7355" }}>{n.time}</span>
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
            <div style={{
              width: 36, height: 36, background: "#2D6A5C", borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
              border: "2px solid #E8F2EF", cursor: "pointer", transition: "all 0.2s",
            }}>
              {currentPsychologist.avatarInitials}
            </div>
          </Link>
        </div>
      </header>

      {/* Toast уведомления */}
      <ToastContainer messages={toasts} onClose={removeToast} />
    </>
  );
}
