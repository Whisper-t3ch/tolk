import React, { useState } from "react";
import { Check } from "lucide-react";

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Checkbox({ label, className, checked, onChange, ...props }: CheckboxProps) {
  const [isChecked, setIsChecked] = useState(checked || false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsChecked(e.target.checked);
    onChange?.(e);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          position: "relative",
          width: 18,
          height: 18,
          border: `2px solid ${isChecked ? "#2D6A5C" : "#E5DFD5"}`,
          borderRadius: 4,
          backgroundColor: isChecked ? "#2D6A5C" : "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <input
          type="checkbox"
          {...props}
          checked={isChecked}
          onChange={handleChange}
          style={{
            position: "absolute",
            opacity: 0,
            cursor: "pointer",
            width: "100%",
            height: "100%",
          }}
        />
        {isChecked && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
      </div>
      {label && (
        <label
          style={{
            fontSize: 14,
            color: "#1C1C1E",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          {label}
        </label>
      )}
    </div>
  );
}
