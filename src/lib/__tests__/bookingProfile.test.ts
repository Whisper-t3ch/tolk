import { describe, it, expect } from "vitest";
import { normalizeLink, sanitizeProfile, sanitizeServices, sanitizeReviews } from "../bookingProfile";

describe("normalizeLink", () => {
  it("telegram: @ник и ссылка приводятся к https://t.me", () => {
    expect(normalizeLink("telegram", "@anton_psy")).toBe("https://t.me/anton_psy");
    expect(normalizeLink("telegram", "t.me/anton_psy")).toBe("https://t.me/anton_psy");
    expect(normalizeLink("telegram", "javascript:alert(1)")).toBeNull();
  });
  it("vk и сайт: только http(s)", () => {
    expect(normalizeLink("vk", "vk.com/id1")).toBe("https://vk.com/id1");
    expect(normalizeLink("website", "example.ru")).toBe("https://example.ru/");
    expect(normalizeLink("website", "javascript:alert(1)")).toBeNull();
    expect(normalizeLink("website", "data:text/html,x")).toBeNull();
    expect(normalizeLink("website", "")).toBe("");
  });
});

describe("sanitizeProfile", () => {
  it("режет длину, чистит списки и отклоняет не-JPEG фото", () => {
    const ok = sanitizeProfile({ headline: "x".repeat(300), tags: ["a", "", "b"], about: "t", links: { telegram: "@abcde" }, qualifications: ["q"], accent: "blue" });
    expect(ok.value?.headline.length).toBe(120);
    expect(ok.value?.tags).toEqual(["a", "b"]);
    expect(ok.value?.accent).toBe("blue");
    expect(sanitizeProfile({ photo: "data:image/svg+xml;base64,AAAA" }).error).toBeTruthy();
    expect(sanitizeProfile({ links: { website: "javascript:1" } }).error).toBeTruthy();
    expect(sanitizeProfile({ accent: "pink" }).value?.accent).toBe("green");
  });
});

describe("sanitizeServices / sanitizeReviews", () => {
  it("проверяет длительность и цену", () => {
    expect(sanitizeServices([{ title: "Консультация", duration_minutes: 50, price: 3000 }]).value?.[0].price).toBe(3000);
    expect(sanitizeServices([{ title: "A", duration_minutes: 5 }]).error).toBeTruthy();
    expect(sanitizeServices([{ title: "", duration_minutes: 50 }]).error).toBeTruthy();
    expect(sanitizeServices([{ title: "A", duration_minutes: 50, price: -1 }]).error).toBeTruthy();
    expect(sanitizeServices([{ title: "A", duration_minutes: 50 }]).value?.[0].price).toBeNull();
  });
  it("отзыв требует автора и текст", () => {
    expect(sanitizeReviews([{ author: "Анна", text: "Спасибо" }]).value?.length).toBe(1);
    expect(sanitizeReviews([{ author: "", text: "x" }]).error).toBeTruthy();
  });
});
