interface LogoMarkProps {
  size?: number;
  className?: string;
  color?: string;
  bubbleColor?: string;
}

/**
 * Логотип ТОЛК: капсула-переключатель (toggle) с буквой "Т" в белом круге —
 * метафора того, что платформа переключает рутину психолога в режим "включено"/автоматизировано.
 * color — цвет капсулы и буквы (по умолчанию шалфей #2D6A5C).
 * bubbleColor — цвет круга-переключателя (по умолчанию белый).
 * Пропорция капсулы фиксированная (width:height ≈ 1.76:1), size управляет высотой.
 */
export function LogoMark({ size = 34, className, color = "#2D6A5C", bubbleColor = "#FFFFFF" }: LogoMarkProps) {
  const width = size * 1.76;
  const height = size;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 300 170"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="0" y="0" width="300" height="170" rx="85" fill={color} />
      <circle cx="215" cy="85" r="61.2" fill={bubbleColor} />
      <text
        x="215"
        y="85"
        fontFamily="Manrope, Arial, sans-serif"
        fontWeight="800"
        fontSize="70"
        fill={color}
        textAnchor="middle"
        dominantBaseline="central"
      >
        Т
      </text>
    </svg>
  );
}

interface LogoProps {
  size?: number;
  showTagline?: boolean;
  tagline?: string;
  textColor?: string;
  taglineColor?: string;
}

export function Logo({ size = 34, showTagline = false, tagline = "Ассистент психолога", textColor = "#1C1C1E", taglineColor = "#8C7355" }: LogoProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <LogoMark size={size} />
      <div>
        <span style={{
          fontSize: size < 30 ? 15 : 18,
          fontWeight: 800,
          color: textColor,
          letterSpacing: "-0.4px",
          lineHeight: 1,
          display: "block",
        }}>
          ТОЛК
        </span>
        {showTagline && (
          <p style={{ fontSize: 10, color: taglineColor, margin: 0, marginTop: 2 }}>
            {tagline}
          </p>
        )}
      </div>
    </div>
  );
}
