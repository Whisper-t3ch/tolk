import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastContainerProps {
  messages: ToastMessage[];
  onClose: (id: string) => void;
}

export function ToastContainer({ messages, onClose }: ToastContainerProps) {
  const iconMap = {
    success: <CheckCircle size={18} style={{ color: "#1BAF7A" }} />,
    error: <AlertCircle size={18} style={{ color: "#EF4444" }} />,
    info: <Info size={18} style={{ color: "#2D6A5C" }} />,
  };

  const bgMap = {
    success: "#E6F7F2",
    error: "#FEE2E2",
    info: "#E8F2EF",
  };

  const textMap = {
    success: "#1BAF7A",
    error: "#EF4444",
    info: "#2D6A5C",
  };

  return (
    <div style={{
      position: "fixed",
      top: 80,
      right: 24,
      zIndex: 200,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <AnimatePresence>
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: -20, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -20, x: 20 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              background: bgMap[msg.type],
              border: `1px solid ${textMap[msg.type]}20`,
              borderRadius: 8,
              color: textMap[msg.type],
              fontSize: 13,
              fontWeight: 500,
              minWidth: 300,
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
            }}
          >
            {iconMap[msg.type]}
            <span>{msg.message}</span>
            <button
              onClick={() => onClose(msg.id)}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: textMap[msg.type],
                opacity: 0.7,
                padding: 0,
              }}
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
