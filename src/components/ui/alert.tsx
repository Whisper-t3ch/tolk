import React from "react";
import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from "lucide-react";
import { motion } from "framer-motion";

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "info" | "success" | "warning" | "error";
  title?: string;
  onClose?: () => void;
  children: React.ReactNode;
}

export function Alert({ variant = "info", title, onClose, children, className, ...props }: AlertProps) {
  const variantConfig: Record<string, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
    info: {
      bg: "#E8F2EF",
      border: "#2D6A5C",
      text: "#2D6A5C",
      icon: <Info style={{ color: "#2D6A5C" }} />,
    },
    success: {
      bg: "#E6F7F2",
      border: "#1BAF7A",
      text: "#1BAF7A",
      icon: <CheckCircle style={{ color: "#1BAF7A" }} />,
    },
    warning: {
      bg: "#FEF3C7",
      border: "#F59E0B",
      text: "#F59E0B",
      icon: <AlertTriangle style={{ color: "#F59E0B" }} />,
    },
    error: {
      bg: "#FEE2E2",
      border: "#EF4444",
      text: "#EF4444",
      icon: <AlertCircle style={{ color: "#EF4444" }} />,
    },
  };

  const config = variantConfig[variant];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      style={{
        backgroundColor: config.bg,
        borderLeft: `4px solid ${config.border}`,
        borderRadius: 8,
        padding: 16,
        display: "flex",
        gap: 16,
      }}
      {...props}
    >
      <div>{config.icon}</div>
      <div style={{ flex: 1 }}>
        {title && (
          <h4 style={{ fontWeight: 600, color: config.text, marginBottom: 4, margin: 0 }}>
            {title}
          </h4>
        )}
        <div style={{ fontSize: 13, color: config.text }}>
          {children}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: config.text,
            cursor: "pointer",
            opacity: 0.7,
            transition: "opacity 0.2s",
          }}
        >
          <X size={18} />
        </button>
      )}
    </motion.div>
  );
}
