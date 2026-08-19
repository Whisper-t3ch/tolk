import React from "react";
import { motion } from "framer-motion";

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"> {
  children: React.ReactNode;
  hoverable?: boolean;
}

// Утилита: разбирает Tailwind-подобный className на флаги раскладки,
// которые нужно продублировать через inline style, т.к. в проекте нет
// подключённого Tailwind-пайплайна для произвольных className на кастомных компонентах.
function parseLayoutClasses(className?: string): React.CSSProperties {
  if (!className) return {};
  const tokens = className.split(" ").filter(Boolean);
  const style: React.CSSProperties = {};
  if (tokens.includes("flex")) style.display = "flex";
  if (tokens.includes("flex-1")) { style.flex = "1 1 0%"; style.minHeight = 0; style.minWidth = 0; }
  if (tokens.includes("flex-col")) style.flexDirection = "column";
  if (tokens.includes("flex-row")) style.flexDirection = "row";
  if (tokens.includes("overflow-y-auto")) style.overflowY = "auto";
  if (tokens.includes("overflow-hidden")) style.overflow = "hidden";
  if (tokens.includes("w-full")) style.width = "100%";
  if (tokens.includes("h-full")) style.height = "100%";
  for (const t of tokens) {
    const pt = t.match(/^pt-(\d+)$/);
    if (pt) style.paddingTop = Number(pt[1]) * 4;
    const pb = t.match(/^pb-(\d+)$/);
    if (pb) style.paddingBottom = Number(pb[1]) * 4;
  }
  return style;
}

export function Card({ children, hoverable = false, className, style, ...props }: CardProps) {
  return (
    <motion.div
      className={className}
      whileHover={hoverable ? { y: -4, boxShadow: "0 12px 32px rgba(79, 126, 255, 0.15)" } : {}}
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #E5DFD5",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(15, 22, 41, 0.06)",
        transition: "all 0.2s ease",
        ...parseLayoutClasses(className),
        ...style,
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({ children, className, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 16,
        paddingBottom: 16,
        borderBottom: "1px solid #E5DFD5",
        ...parseLayoutClasses(className),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardContent({ children, className, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 16,
        paddingBottom: 16,
        ...parseLayoutClasses(className),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardFooter({ children, className, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 16,
        paddingBottom: 16,
        borderTop: "1px solid #E5DFD5",
        backgroundColor: "#F5F3EF",
        borderRadius: "0 0 8px 8px",
        ...parseLayoutClasses(className),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
