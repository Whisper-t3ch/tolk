import { describe, it, expect } from "vitest";
import { parseClientContact } from "../bookingContact";

describe("parseClientContact", () => {
  it("telegram-тег", () => {
    expect(parseClientContact("@ivan_petrov")).toEqual({ kind: "telegram", value: "ivan_petrov" });
    expect(parseClientContact("https://t.me/ivan_petrov")).toEqual({ kind: "telegram", value: "ivan_petrov" });
  });
  it("телефон в разных форматах", () => {
    expect(parseClientContact("+7 (999) 123-45-67")).toEqual({ kind: "phone", value: "+79991234567" });
    expect(parseClientContact("8 999 123 45 67")).toEqual({ kind: "phone", value: "89991234567" });
  });
  it("мусор и пустое", () => {
    expect(parseClientContact("")).toBeNull();
    expect(parseClientContact(undefined)).toBeNull();
    expect(parseClientContact("позвоните мне")).toBeNull();
    expect(parseClientContact("12")).toBeNull();
  });
});
