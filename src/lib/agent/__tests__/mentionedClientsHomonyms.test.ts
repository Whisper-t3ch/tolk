import { describe, it, expect } from "vitest";
import { findMentionedClients } from "../mentionedClients";

const clients = [
  { id: "1", name: "Анна" },
  { id: "2", name: "Анна Петрова" },
  { id: "3", name: "Игорь Смирнов" },
  { id: "4", name: "Мария Соколова" },
];

describe("findMentionedClients: одинаковые имена", () => {
  it("«Анна» без фамилии — клиент Анна, а не Анна Петрова", () => {
    expect(findMentionedClients("Что Анна рассказывала про сон?", clients).map(c => c.id)).toEqual(["1"]);
  });
  it("«Анна Петрова» — только она", () => {
    expect(findMentionedClients("Что у Анны Петровой с отношениями?", clients).map(c => c.id)).toEqual(["2"]);
  });
  it("два разных человека в одном вопросе — оба", () => {
    expect(findMentionedClients("Сравни Игоря и Марию", clients).map(c => c.id).sort()).toEqual(["3", "4"]);
  });
  it("две полные тёзки без различий — обе (модель уточнит)", () => {
    const twins = [{ id: "a", name: "Анна" }, { id: "b", name: "Анна" }];
    expect(findMentionedClients("Что с Анной?", twins).map(c => c.id).sort()).toEqual(["a", "b"]);
  });
});
