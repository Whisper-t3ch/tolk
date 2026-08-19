import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Фон */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              zIndex: 100,
            }}
          />

          {/* Модальное окно */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            onClick={e => e.stopPropagation()}
            style={{
              position: "fixed",
              top: "25%",
              right: 24,
              transform: "translateY(-50%)",
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
              zIndex: 101,
              width: 420,
              maxHeight: "90vh",
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Заголовок */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 24,
              borderBottom: "1px solid #E5DFD5",
            }}>
              <h2 style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#1C1C1E",
                margin: 0,
              }}>
                {title}
              </h2>
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#8C7355",
                  padding: 0,
                }}
              >
                <X size={24} />
              </button>
            </div>

            {/* Содержимое */}
            <div style={{ padding: 24 }}>
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
