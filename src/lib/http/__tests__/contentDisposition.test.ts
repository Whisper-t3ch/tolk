import { describe, it, expect } from "vitest";
import { attachmentDisposition } from "../contentDisposition";

describe("attachmentDisposition", () => {
  it("кириллическое имя: только latin1 в заголовке, utf-8 в filename*", () => {
    const h = attachmentDisposition("session_2026-10-18_Артем_тест.txt");
    expect(/^[\x20-\x7e]*$/.test(h)).toBe(true);
    expect(h).toContain("filename*=UTF-8''session_2026-10-18_%D0%90");
    expect(h).toContain('filename="session_2026-10-18_.txt"');
    expect(() => new Headers({ "Content-Disposition": h })).not.toThrow();
  });
  it("ascii-имя остаётся как есть", () => {
    const h = attachmentDisposition("report.txt");
    expect(h).toContain('filename="report.txt"');
  });
  it("явный fallback", () => {
    expect(attachmentDisposition("Протокол.pdf", "protokol.pdf")).toContain('filename="protokol.pdf"');
  });
  it("кавычки не ломают заголовок", () => {
    const h = attachmentDisposition('a"b.txt');
    expect(h).toContain('filename="a_b.txt"');
  });
});
