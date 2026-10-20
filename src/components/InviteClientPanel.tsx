"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Send, Check, Share2, Mail, MessageSquare } from "lucide-react";

// Блок «Пригласить клиента» на странице сессии: при подключении психолога к звонку ссылка
// автоматически уходит клиенту в чат (если он привязан); кнопки — отправить ещё раз и скопировать.

type Delivery =
  | { status: "sent"; channel: string }
  | { status: "already_sent"; channel: string }
  | { status: "no_channel" }
  | { status: "failed"; error: string };

const CHANNEL_NAMES: Record<string, string> = { telegram: "Telegram", vk: "VK" };

function describe(d: Delivery | null): { text: string; color: string } {
  if (!d) return { text: "", color: "#6B6058" };
  if (d.status === "sent") return { text: `Ссылка отправлена клиенту в ${CHANNEL_NAMES[d.channel] ?? d.channel}.`, color: "#2D6A5C" };
  if (d.status === "already_sent") return { text: `Ссылка уже была отправлена клиенту в ${CHANNEL_NAMES[d.channel] ?? d.channel}. Отправьте ещё раз или скопируйте.`, color: "#6B6058" };
  if (d.status === "failed") return { text: `Не удалось отправить в чат: ${d.error}. Скопируйте ссылку и отправьте клиенту сами.`, color: "#B45309" };
  return { text: "У клиента нет подключённого чата. Скопируйте ссылку и отправьте клиенту сами.", color: "#6B6058" };
}

export default function InviteClientPanel({ sessionId, autoSend }: { sessionId: string; autoSend: boolean }) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoDone = useRef(false);

  async function createInvite(resend: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resend }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Не удалось создать ссылку");
      setUrl(json.url as string);
      setDelivery(json.delivery as Delivery);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать ссылку");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoSend && !autoDone.current) {
      autoDone.current = true;
      void createInvite(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Скопируйте ссылку:", url);
    }
  }

  const info = describe(delivery);

  // Ссылку можно отправить не только в Telegram/VK: системное меню «Поделиться» (любой мессенджер,
  // в том числе MAX и WhatsApp), письмо или SMS — психолог сам выбирает адресата.
  const shareText = url
    ? `Здравствуйте! Ссылка на видеосессию: ${url}\nОткрывайте с устройства, где есть камера и микрофон. Перед входом в звонок лучше отключить VPN — со включённым VPN связь может тормозить.`
    : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function share() {
    if (!url) return;
    try {
      await navigator.share({ title: "Ссылка на видеосессию", text: shareText });
    } catch {
      /* человек закрыл меню — не ошибка */
    }
  }

  return (
    <div style={{ marginBottom: 12, padding: "10px 12px", border: "1px solid #E5DFD5", borderRadius: 8, background: "#FAF8F4" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>Клиент</span>
        <button
          type="button"
          onClick={() => createInvite(true)}
          disabled={loading}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #2D6A5C", color: "#2D6A5C", background: "#fff", cursor: loading ? "default" : "pointer" }}
        >
          <Send size={13} />
          {url ? "Отправить ссылку ещё раз" : "Пригласить клиента"}
        </button>
        {url && (
          <button
            type="button"
            onClick={copy}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #E5DFD5", color: "#1C1C1E", background: "#fff", cursor: "pointer" }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Скопировано" : "Скопировать ссылку"}
          </button>
        )}
        {url && canShare && (
          <button
            type="button"
            onClick={share}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #E5DFD5", color: "#1C1C1E", background: "#fff", cursor: "pointer" }}
          >
            <Share2 size={13} /> Поделиться
          </button>
        )}
        {url && (
          <a
            href={`mailto:?subject=${encodeURIComponent("Ссылка на видеосессию")}&body=${encodeURIComponent(shareText)}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #E5DFD5", color: "#1C1C1E", background: "#fff", textDecoration: "none" }}
          >
            <Mail size={13} /> На почту
          </a>
        )}
        {url && (
          <a
            href={`sms:?&body=${encodeURIComponent(shareText)}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #E5DFD5", color: "#1C1C1E", background: "#fff", textDecoration: "none" }}
          >
            <MessageSquare size={13} /> SMS
          </a>
        )}
      </div>
      {(info.text || error) && (
        <p style={{ fontSize: 12, margin: "8px 0 0", color: error ? "#B91C1C" : info.color }}>{error ?? info.text}</p>
      )}
    </div>
  );
}
