import React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "muted";
  children: React.ReactNode;
}

export function Badge({ variant = "default", children, className, ...props }: BadgeProps) {
  const variantStyles: Record<string, React.CSSProperties> = {
    default: { backgroundColor: "#2D6A5C", color: "#FFFFFF" },
    primary: { backgroundColor: "#2D6A5C", color: "#FFFFFF" },
    success: { backgroundColor: "#1BAF7A", color: "#FFFFFF" },
    warning: { backgroundColor: "#F59E0B", color: "#FFFFFF" },
    danger: { backgroundColor: "#EF4444", color: "#FFFFFF" },
    muted: { backgroundColor: "#F5F3EF", color: "#6B6058" },
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 4,
        paddingBottom: 4,
        borderRadius: 16,
        fontSize: 12,
        fontWeight: 500,
        ...variantStyles[variant],
      }}
      {...props}
    >
      {children}
    </span>
  );
}
