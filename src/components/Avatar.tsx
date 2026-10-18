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
