"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Phone, Copy, Check } from "lucide-react";

interface ConferenceModalProps {
  isOpen: boolean;
  clientName: string;
  conferenceLink: string;
  onClose: () => void;
}

export default function ConferenceModal({ isOpen, clientName, conferenceLink, onClose }: ConferenceModalProps) {
  const [copied, setCopied] = useState(false);
  const [clientConnected, setClientConnected] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Имитация подключения клиента через 15-30 секунд
      const delay = Math.random() * 15000 + 15000;
      const timer = setTimeout(() => {
        setClientConnected(true);
      }, delay);

      return () => clearTimeout(timer);
    } else {
      setClientConnected(false);
    }
  }, [isOpen]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(conferenceLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.4)",
              zIndex: 65,
              backdropFilter: "blur(2px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
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
              zIndex: 70,
              pointerEvents: "auto",
            }}
          >
            <div style={{
              background: "#FFFFFF",
              borderRadius: 20,
              boxShadow: "0 30px 80px rgba(0, 0, 0, 0.25)",
              width: "95%",
              maxWidth: 550,
              maxHeight: "90vh",
              padding: 0,
              overflow: "hidden",
            }}
          >
            {/* Хедер */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #E5DFD5",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                Сессия с {clientName}
              </h2>
              <button
                onClick={onClose}
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

            {/* Содержимое */}
            <div style={{ padding: "32px 24px", textAlign: "center", height: 420, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <AnimatePresence mode="wait">
                {!clientConnected ? (
                  <motion.div
                    key="waiting"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    style={{ width: "100%" }}
                  >
                    {/* Ожидание подключения */}
                  <motion.div
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    style={{
                      width: 100,
                      height: 100,
                      background: "linear-gradient(135deg, #E8F2EF 0%, #E6F7F2 100%)",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 28px",
                      boxShadow: "0 12px 40px rgba(79, 126, 255, 0.2)",
                    }}
                  >
                    <Phone size={48} style={{ color: "#2D6A5C" }} />
                  </motion.div>

                  <h3 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E", margin: "0 0 12px 0" }}>
                    Ожидание подключения
                  </h3>
                  <p style={{ fontSize: 14, color: "#6B6058", margin: "0 0 28px 0", lineHeight: "1.5" }}>
                    {clientName} получил(а) ссылку и может присоединиться в любой момент
                  </p>

                  {/* Ссылка конференции */}
                  <div
                    style={{
                      background: "#F5F3EF",
                      borderRadius: 10,
                      padding: "12px 14px",
                      marginBottom: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "space-between",
                      border: "1px solid #E5DFD5",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#6B6058", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {conferenceLink.substring(0, 40)}...
                    </div>
                    <button
                      onClick={copyToClipboard}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#2D6A5C",
                        padding: 4,
                        flexShrink: 0,
                      }}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>

                  {/* Статус */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "center",
                      fontSize: 12,
                      color: "#8C7355",
                    }}
                  >
                    <motion.div
                      animate={{ opacity: [0.5, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      style={{
                        width: 8,
                        height: 8,
                        background: "#F59E0B",
                        borderRadius: "50%",
                      }}
                    />
                    Поиск подключения...
                  </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="connected"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    style={{ width: "100%" }}
                  >
                    {/* Клиент подключился */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 250, damping: 20 }}
                    style={{
                      width: 100,
                      height: 100,
                      background: "linear-gradient(135deg, #E6F7F2 0%, #D0F1E8 100%)",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 28px",
                      boxShadow: "0 12px 40px rgba(27, 175, 122, 0.2)",
                    }}
                  >
                    <Check size={48} style={{ color: "#1BAF7A" }} />
                  </motion.div>

                  <h3 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E", margin: "0 0 12px 0" }}>
                    {clientName} подключился(ась)!
                  </h3>
                  <p style={{ fontSize: 14, color: "#6B6058", margin: "0 0 28px 0", lineHeight: "1.5" }}>
                    Начните видео конференцию
                  </p>

                  <button
                    onClick={onClose}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      background: "#1BAF7A",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    Начать сессию
                  </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Кнопка отмены */}
            <div
              style={{
                padding: "12px 24px",
                borderTop: "1px solid #E5DFD5",
                display: "flex",
                gap: 12,
              }}
            >
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  background: "#F5F3EF",
                  color: "#1C1C1E",
                  border: "1px solid #E5DFD5",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                Отмена
              </button>
            </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
