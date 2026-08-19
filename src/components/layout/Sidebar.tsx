"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Users, Video, Bot, FileText,
  BookOpen, Brain, Settings, Plus, X,
  ClipboardList, HelpCircle, Sparkles
} from "lucide-react";
import { currentPsychologist, clients } from "@/lib/mock-data";
import { useSession } from "@/lib/SessionContext";
import ConferenceModal from "@/components/ConferenceModal";
import { LogoMark } from "@/components/Logo";

const navItems = [
  { href: "/dashboard",      icon: LayoutDashboard, label: "Главная" },
  { href: "/sessions",       icon: Video,           label: "Сессии" },
  { href: "/clients",        icon: Users,           label: "Клиенты" },
  { href: "/note-templates", icon: ClipboardList,   label: "Шаблоны протоколов" },
  { href: "/knowledge",      icon: Brain,           label: "База знаний" },
  { href: "/reflections",    icon: BookOpen,        label: "Рефлексии" },
];

// Второстепенная группа инструментов — существующие фичи, не входящие в основной upheal-подобный список
const toolItems = [
  { href: "/assistant", icon: Sparkles, label: "Ассистент" },
  { href: "/content",   icon: FileText, label: "Контент" },
];

const bottomItems = [
  { href: "/help",     icon: HelpCircle, label: "Помощь" },
  { href: "/settings", icon: Settings,   label: "Настройки" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { plan, avatarInitials, name, specialty, roomUrl } = currentPsychologist;
  const creditPct = Math.round((plan.assistantRequests.used / plan.assistantRequests.total) * 100);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showConference, setShowConference] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [conferenceClientName, setConferenceClientName] = useState("");
  const [notification, setNotification] = useState<string | null>(null);
  const { addSession } = useSession();
  const sidebarRef = useRef<HTMLDivElement>(null);

  const createSession = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    // Создаём сессию в календаре
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    addSession({
      clientId,
      clientName: client.name,
      date: dateStr,
      time: timeStr,
    });

    // Открываем окно конференции
    setConferenceClientName(client.name);
    setShowConference(true);
    setShowNewSession(false);
    setSelectedClientId(null);

    // Уведомление
    setNotification(`Ссылка на конференцию отправлена ${client.name}`);
    setTimeout(() => setNotification(null), 3000);
  };

  const renderNavItem = ({ href, icon: Icon, label }: { href: string; icon: typeof LayoutDashboard; label: string }) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    const isHovered = hoveredItem === href;

    return (
      <Link
        key={href}
        href={href}
        onMouseEnter={() => setHoveredItem(href)}
        onMouseLeave={() => setHoveredItem(null)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: isExpanded ? "flex-start" : "center",
          gap: 10,
          padding: "10px 14px",
          color: active ? "#FFFFFF" : "#1C1C1E",
          backgroundColor: active
            ? "#2D6A5C"
            : isHovered
            ? "#F5F3EF"
            : "transparent",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: active ? 700 : 600,
          textDecoration: "none",
          border: "none",
          transition: "all 0.2s ease",
          cursor: "pointer",
          transform: isHovered || active ? "translateY(-2px)" : "translateY(0)",
          boxShadow: active
            ? "0 4px 12px rgba(79, 126, 255, 0.25)"
            : isHovered
            ? "0 2px 8px rgba(79, 126, 255, 0.1)"
            : "none",
          position: "relative",
          minWidth: 44,
          fontFamily: "var(--font-sans)",
        }}
      >
        <motion.div
          animate={{ scale: isHovered || active ? 1.1 : 1 }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon
            size={16}
            style={{
              color: active ? "#FFFFFF" : "#1C1C1E",
              opacity: active || isHovered ? 1 : 0.7
            }}
          />
        </motion.div>
        {isExpanded && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 }}
            style={{
              whiteSpace: "nowrap",
              color: active ? "#FFFFFF" : "#1C1C1E",
            }}
          >
            {label}
          </motion.span>
        )}
        {active && (
          <motion.div
            layoutId="activeIndicator"
            style={{
              position: "absolute",
              right: 8,
              width: 6,
              height: 6,
              background: "#FFFFFF",
              borderRadius: "50%",
            }}
          />
        )}
      </Link>
    );
  };

  return (
    <>
      <motion.aside
        ref={sidebarRef}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
        animate={{ width: isExpanded ? 240 : 80 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        style={{
          height: "100vh",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          left: 0, top: 0, bottom: 0,
          zIndex: 50,
          borderRight: "1px solid #E5DFD5",
          boxShadow: "2px 0 8px rgba(15, 22, 41, 0.06)",
          overflow: "hidden",
        }}
      >
        {/* Логотип */}
        <div style={{
          padding: "20px 16px",
          borderBottom: "1px solid #E5DFD5",
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: 70,
        }}>
          <Link
            href="/dashboard"
            style={{ display: "flex", alignItems: "center", gap: isExpanded ? 10 : 0, textDecoration: "none", cursor: "pointer" }}
          >
            <LogoMark size={34} className="flex-shrink-0" />
            {isExpanded && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
                <span style={{
                  fontSize: 16, fontWeight: 700,
                  color: "#1C1C1E", letterSpacing: "-0.3px",
                  whiteSpace: "nowrap",
                }}>ТОЛК</span>
                <p style={{
                  fontSize: 10, color: "#8C7355",
                  marginTop: 2,
                  margin: 0,
                }}>Ассистент психолога</p>
              </motion.div>
            )}
          </Link>
        </div>

        {/* Новая сессия кнопка */}
        <div style={{
          padding: "12px",
          borderBottom: "1px solid #E5DFD5",
          display: "flex",
          justifyContent: "center",
        }}>
          <button
            onClick={() => setShowNewSession(true)}
            onMouseEnter={() => setHoveredItem("new-session")}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              width: isExpanded ? "100%" : "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "10px 14px",
              background: hoveredItem === "new-session" ? "#E8F2EF" : "#F5F3EF",
              color: "#2D6A5C",
              border: "1px solid #E5DFD5",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s ease",
              transform: hoveredItem === "new-session" ? "translateY(-2px)" : "translateY(0)",
              boxShadow: hoveredItem === "new-session" ? "0 2px 8px rgba(79, 126, 255, 0.15)" : "none",
              fontFamily: "var(--font-sans)",
            }}
          >
            <Plus size={16} style={{ flexShrink: 0 }} />
            {isExpanded && <span style={{ whiteSpace: "nowrap" }}>Новая сессия</span>}
          </button>
        </div>

        {/* Навигация */}
        <nav style={{
          flex: 1,
          padding: "16px 12px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {navItems.map((item) => renderNavItem(item))}
          </div>

          {/* Инструменты */}
          <div>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#8C7355",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  padding: "0 14px 8px",
                }}
              >
                Инструменты
              </motion.div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {toolItems.map((item) => renderNavItem(item))}
            </div>
          </div>
        </nav>

        {/* Помощь / Настройки — закреплены внизу */}
        <div style={{
          padding: "12px",
          borderTop: "1px solid #E5DFD5",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          {bottomItems.map((item) => renderNavItem(item))}
        </div>

        {/* Запросы к ассистенту */}
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              margin: "0 12px 8px",
              background: "#F5F3EF",
              borderRadius: 10,
              padding: "12px 14px",
              border: "1px solid #E5DFD5",
            }}
          >
            <div style={{
              display: "flex", justifyContent: "space-between",
              fontSize: 11, color: "#8C7355",
              marginBottom: 6,
              fontWeight: 500,
            }}>
              <span>Запросы · {plan.name}</span>
              <span style={{ color: "#1C1C1E", fontWeight: 600 }}>
                {plan.assistantRequests.used} / {plan.assistantRequests.total}
              </span>
            </div>
            <div style={{
              height: 4, background: "rgba(79, 126, 255, 0.1)",
              borderRadius: 4, overflow: "hidden",
            }}>
              <div style={{
                width: `${creditPct}%`, height: "100%",
                background: "#2D6A5C",
                borderRadius: 4,
                transition: "width 0.3s ease",
              }} />
            </div>
          </motion.div>
        )}

        {/* Аватар психолога */}
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              padding: "10px 12px 16px",
              display: "flex", alignItems: "center", gap: 10,
              borderTop: "1px solid #E5DFD5",
            }}
          >
            <div style={{
              width: 34, height: 34,
              background: "#2D6A5C",
              borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, color: "#FFFFFF",
              flexShrink: 0,
            }}>{avatarInitials}</div>
            <div style={{ overflow: "hidden" }}>
              <div style={{
                fontSize: 13, fontWeight: 500,
                color: "#1C1C1E",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{name}</div>
              <div style={{
                fontSize: 11, color: "#8C7355",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{specialty}</div>
            </div>
          </motion.div>
        )}
      </motion.aside>

      {/* Модальное окно выбора клиента */}
      <AnimatePresence>
        {showNewSession && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewSession(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.4)",
                zIndex: 40,
                backdropFilter: "blur(2px)",
              }}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 45,
              }}
            >
              <div style={{
                background: "#FFFFFF",
                borderRadius: 16,
                boxShadow: "0 25px 80px rgba(0, 0, 0, 0.2)",
                width: "90%",
                maxWidth: 420,
                maxHeight: "85vh",
                overflowY: "auto",
              }}
            >
              <div style={{
                padding: "24px",
                borderBottom: "1px solid #E5DFD5",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                  Новая сессия
                </h2>
                <button
                  onClick={() => setShowNewSession(false)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#8C7355",
                    padding: 4,
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{
                padding: "16px",
                maxHeight: "calc(85vh - 240px)",
                overflowY: "auto",
                scrollBehavior: "smooth",
              }}>
                <p style={{ fontSize: 12, color: "#6B6058", marginBottom: 12 }}>
                  Выберите клиента для встречи:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {clients.map((client, idx) => (
                    <button
                      key={client.id}
                      onClick={() => createSession(client.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px",
                        background: selectedClientId === client.id ? "#E8F2EF" : "#FFFFFF",
                        border: selectedClientId === client.id ? "1px solid #2D6A5C" : "1px solid #E5DFD5",
                        borderRadius: 8,
                        cursor: "pointer",
                        transition: "all 0.2s",
                        textAlign: "left",
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      <div style={{
                        width: 40,
                        height: 40,
                        background: ["#2D6A5C", "#1BAF7A", "#F59E0B"][idx % 3],
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#fff",
                        flexShrink: 0,
                      }}>
                        {client.initials}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>
                          {client.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#8C7355" }}>
                          {client.age} лет
                        </div>
                      </div>
                      <div style={{
                        padding: "4px 8px",
                        background: client.status === "active" ? "#E6F7F2" : "#FEF3C7",
                        color: client.status === "active" ? "#1BAF7A" : "#F59E0B",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                      }}>
                        {client.status === "active" ? "Активный" : "На паузе"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{
                padding: "16px",
                borderTop: "1px solid #E5DFD5",
                background: "#F5F3EF",
                borderRadius: "0 0 12px 12px",
                fontSize: 11,
                color: "#6B6058",
                textAlign: "center",
              }}>
                ✅ Клиенту будет отправлена ссылка для присоединения к конференции
              </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Модал конференции */}
      <ConferenceModal
        isOpen={showConference}
        clientName={conferenceClientName}
        conferenceLink={`${currentPsychologist.roomUrl}/${conferenceClientName}`}
        onClose={() => setShowConference(false)}
      />

      {/* Уведомление */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: "fixed",
              top: 24,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#1BAF7A",
              color: "#fff",
              padding: "12px 20px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              zIndex: 60,
              boxShadow: "0 4px 12px rgba(27, 175, 122, 0.3)",
            }}
          >
            {notification}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        /* Кастомный скролл для модалов */
        div[style*="maxHeight"][style*="overflowY"]::-webkit-scrollbar {
          width: 6px;
        }
        div[style*="maxHeight"][style*="overflowY"]::-webkit-scrollbar-track {
          background: transparent;
        }
        div[style*="maxHeight"][style*="overflowY"]::-webkit-scrollbar-thumb {
          background: #D1D5DB;
          border-radius: 3px;
        }
        div[style*="maxHeight"][style*="overflowY"]::-webkit-scrollbar-thumb:hover {
          background: #9CA3AF;
        }
      `}</style>
    </>
  );
}
