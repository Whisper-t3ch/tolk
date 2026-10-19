"use client";

/** Аватар психолога: фото (если загружено) или инициалы на зелёном фоне. */
export default function Avatar({
  src,
  initials,
  size,
  fontSize,
  border,
}: {
  src?: string | null;
  initials: string;
  size: number;
  fontSize?: number;
  border?: string;
}) {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    border,
    overflow: "hidden",
  };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={{ ...base, objectFit: "cover", display: "block" }} />;
  }
  return (
    <div
      style={{
        ...base,
        background: "#2D6A5C",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: fontSize ?? Math.round(size / 3),
        fontWeight: 700,
        color: "#FFFFFF",
      }}
    >
      {initials}
    </div>
  );
}

/** Содержимое кружка клиента: фото из мессенджера (если есть) или инициалы. Кружок (размер, фон) задаёт родитель. */
export function ClientFace({ avatarData, initials }: { avatarData?: string | null; initials: string }) {
  if (avatarData) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarData} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }} />;
  }
  return <>{initials}</>;
}
