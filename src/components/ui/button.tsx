import React, { useState } from "react";
import { motion } from "framer-motion";

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const [isPressed, setIsPressed] = useState(false);

  // Цвета для каждого варианта: основной цвет и цвет тени (тёмнее)
  const colorMap: Record<string, { main: string; shadow: string; text: string }> = {
    primary: {
      main: "#2D6A5C",
      shadow: "#1F4E43",
      text: "#FFFFFF",
    },
    secondary: {
      main: "#F5F3EF",
      shadow: "#E5DFD5",
      text: "#1C1C1E",
    },
    outline: {
      main: "#FFFFFF",
      shadow: "#E5DFD5",
      text: "#1C1C1E",
    },
    ghost: {
      main: "transparent",
      shadow: "transparent",
      text: "#1C1C1E",
    },
    danger: {
      main: "#EF4444",
      shadow: "#DC2626",
      text: "#FFFFFF",
    },
  };

  const colors = colorMap[variant];

  const sizeStyles: Record<string, { padding: string; fontSize: number; shadowHeight: number }> = {
    sm: {
      padding: "6px 12px",
      fontSize: 12,
      shadowHeight: 2,
    },
    md: {
      padding: "8px 16px",
      fontSize: 13,
      shadowHeight: 4,
    },
    lg: {
      padding: "12px 24px",
      fontSize: 14,
      shadowHeight: 6,
    },
  };

  const size_config = sizeStyles[size];
  const classTokens = className?.split(" ").filter(Boolean) ?? [];
  const isFullWidth = classTokens.includes("w-full");
  const isRoundedFull = classTokens.includes("rounded-full");
  const isNoPadding = classTokens.includes("p-0");
  const isFlexCenter = classTokens.includes("flex") && classTokens.includes("items-center") && classTokens.includes("justify-center");

  let fixedWidth: number | undefined;
  let fixedHeight: number | undefined;
  for (const t of classTokens) {
    const w = t.match(/^w-(\d+)$/);
    if (w) fixedWidth = Number(w[1]) * 4;
    const h = t.match(/^h-(\d+)$/);
    if (h) fixedHeight = Number(h[1]) * 4;
  }

  const borderRadius = isRoundedFull ? "50%" : 8;

  return (
    <div style={{
      display: isFullWidth ? "block" : "inline-block",
      position: "relative",
      width: isFullWidth ? "100%" : fixedWidth,
    }}>
      {/* Тень/3D эффект (видна только когда кнопка не нажата) */}
      {variant !== "ghost" && (
        <div
          style={{
            position: "absolute",
            bottom: isPressed ? 0 : size_config.shadowHeight,
            left: 0,
            right: 0,
            height: size_config.shadowHeight,
            backgroundColor: colors.shadow,
            borderRadius,
            transition: "all 0.1s ease",
            zIndex: -1,
          }}
        />
      )}

      {/* Основная кнопка */}
      <motion.button
        className={className}
        onMouseDown={() => !disabled && setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onMouseLeave={() => setIsPressed(false)}
        onTouchStart={() => !disabled && setIsPressed(true)}
        onTouchEnd={() => setIsPressed(false)}
        whileHover={!disabled ? { y: -2 } : {}}
        animate={isPressed && !disabled ? { y: size_config.shadowHeight } : { y: 0 }}
        style={{
          fontWeight: 600,
          borderRadius,
          transition: "all 0.1s ease",
          cursor: disabled ? "not-allowed" : "pointer",
          border: "none",
          fontFamily: "var(--font-sans)",
          display: isFlexCenter ? "flex" : "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : 1,
          padding: isNoPadding ? 0 : size_config.padding,
          fontSize: size_config.fontSize,
          backgroundColor: isPressed && !disabled ? colors.shadow : colors.main,
          color: colors.text,
          outline: "none",
          width: isFullWidth ? "100%" : fixedWidth,
          height: fixedHeight,
          whiteSpace: "normal",
          textAlign: "center",
        }}
        disabled={disabled}
        {...props}
      >
        {children}
      </motion.button>
    </div>
  );
}
