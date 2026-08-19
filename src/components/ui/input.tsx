import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div style={{ width: "100%" }}>
      {label && (
        <label style={{
          display: "block",
          fontSize: 13,
          fontWeight: 600,
          color: "#1C1C1E",
          marginBottom: 8,
        }}>
          {label}
        </label>
      )}
      <input
        style={{
          width: "100%",
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 8,
          paddingBottom: 8,
          border: error ? "1px solid #EF4444" : "1px solid #E5DFD5",
          borderRadius: 8,
          fontSize: 14,
          fontFamily: "var(--font-sans)",
          color: "#1C1C1E",
          backgroundColor: "#FFFFFF",
          transition: "all 0.2s",
          boxSizing: "border-box",
        }}
        {...props}
      />
      {error && (
        <p style={{ fontSize: 12, color: "#EF4444", marginTop: 6, margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Textarea({
  label,
  error,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  return (
    <div style={{ width: "100%" }}>
      {label && (
        <label style={{
          display: "block",
          fontSize: 13,
          fontWeight: 600,
          color: "#1C1C1E",
          marginBottom: 8,
        }}>
          {label}
        </label>
      )}
      <textarea
        style={{
          width: "100%",
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 8,
          paddingBottom: 8,
          border: error ? "1px solid #EF4444" : "1px solid #E5DFD5",
          borderRadius: 8,
          fontSize: 14,
          fontFamily: "var(--font-sans)",
          color: "#1C1C1E",
          backgroundColor: "#FFFFFF",
          transition: "all 0.2s",
          resize: "none",
          boxSizing: "border-box",
        }}
        {...props}
      />
      {error && (
        <p style={{ fontSize: 12, color: "#EF4444", marginTop: 6, margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
