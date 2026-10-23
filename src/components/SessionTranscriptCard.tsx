"use client";
import { useEffect, useState } from "react";
import { Copy, Download, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Расшифровка сессии прямо на странице протокола: можно прочитать, скопировать целиком
 * и скачать .txt. Если расшифровки ещё нет (404), блок не показывается.
 */
export default function SessionTranscriptCard({ sessionId, refreshKey = 0 }: { sessionId: string; refreshKey?: number }) {
  const [text, setText] = useState<string | null>(null);
  const [filename, setFilename] = useState("transcript.txt");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/export/transcript`);
        if (!res.ok || cancelled) return;
        const match = (res.headers.get("Content-Disposition") ?? "").match(/filename="([^"]+)"/);
        const body = await res.text();
        if (cancelled) return;
        if (match?.[1]) setFilename(match[1]);
        setText(body);
      } catch {
        /* нет расшифровки или сеть — блок просто не показываем */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (!text) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text ?? "");
    } catch {
      // Запасной вариант для браузеров без доступа к буферу обмена.
      const ta = document.createElement("textarea");
      ta.value = text ?? "";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    // BOM, чтобы кириллица корректно открывалась в Блокноте Windows.
    const blob = new Blob(["﻿", text ?? ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: 16, border: "1px solid #E5DFD5", borderRadius: 12, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "12px 14px" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>Расшифровка сессии</div>
          <div style={{ fontSize: 12, color: "#6F5A3F", marginTop: 2 }}>{text.length.toLocaleString("ru-RU")} символов</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied
              ? <><CheckCircle size={13} style={{ marginRight: 5 }} /> Скопировано</>
              : <><Copy size={13} style={{ marginRight: 5 }} /> Копировать</>}
          </Button>
          <Button variant="secondary" size="sm" onClick={download}>
            <Download size={13} style={{ marginRight: 5 }} /> Скачать .txt
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>
            {open ? <><ChevronUp size={13} style={{ marginRight: 5 }} /> Скрыть</> : <><ChevronDown size={13} style={{ marginRight: 5 }} /> Показать</>}
          </Button>
        </div>
      </div>
      {open && (
        <pre
          style={{
            margin: 0, padding: "0 14px 14px", maxHeight: 420, overflow: "auto",
            whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-sans)",
            fontSize: 13, lineHeight: 1.6, color: "#1C1C1E", userSelect: "text",
          }}
        >
          {text}
        </pre>
      )}
    </div>
  );
}
