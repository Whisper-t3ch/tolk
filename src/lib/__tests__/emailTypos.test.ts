import { describe, it, expect } from "vitest";
import { suggestEmailFix } from "../emailTypos";

describe("suggestEmailFix", () => {
  it("gmail.ru -> gmail.com", () => expect(suggestEmailFix("2970371@gmail.ru")).toBe("2970371@gmail.com"));
  it("регистр домена и пробелы", () => expect(suggestEmailFix(" Anna@Mail.RY ")).toBe("Anna@mail.ru"));
  it("нормальные адреса не трогаем", () => {
    expect(suggestEmailFix("a@gmail.com")).toBeNull();
    expect(suggestEmailFix("a@merenika.ru")).toBeNull();
    expect(suggestEmailFix("нет собаки")).toBeNull();
  });
});
