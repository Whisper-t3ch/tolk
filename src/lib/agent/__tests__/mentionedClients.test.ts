import { describe, expect, it } from "vitest";
import { findMentionedClients } from "../mentionedClients";

const clients = [
  { id: "1", name: "Катя Синицына" },
  { id: "2", name: "Анна Тестова" },
  { id: "3", name: "Игорь Образцов" },
];

describe("findMentionedClients", () => {
  it("находит по имени в разных падежах", () => {
    expect(findMentionedClients("Что было на последней сессии с Катей?", clients).map(c => c.id)).toEqual(["1"]);
    expect(findMentionedClients("Подготовь меня к сессии с Анной", clients).map(c => c.id)).toEqual(["2"]);
    expect(findMentionedClients("Покажи заметки по Игорю Образцову", clients).map(c => c.id)).toEqual(["3"]);
  });
  it("находит по фамилии", () => {
    expect(findMentionedClients("что у Синицыной с гневом", clients).map(c => c.id)).toEqual(["1"]);
  });
  it("не срабатывает на похожие слова", () => {
    expect(findMentionedClients("Какая категория у задания? катастрофа", clients)).toEqual([]);
  });
  it("пусто, если никого нет", () => {
    expect(findMentionedClients("Покажи моих клиентов", clients)).toEqual([]);
  });
});

import { knowledgeBaseRedirect } from "../mentionedClients";

describe("knowledgeBaseRedirect", () => {
  const katya = [{ id: "187d787b-acb3-4ce6-bfdc-60ccf669eb2c", name: "Катя Синицына" }];
  it("перенаправляет запросы о клиенте и содержании сессий", () => {
    expect(knowledgeBaseRedirect("как узнать содержание последней сессии Катя Синицына id: 187d787b-acb3-4ce6-bfdc-60ccf669eb2c", katya)).not.toBeNull();
    expect(knowledgeBaseRedirect("как узнать содержание последней сессии по клиенту", katya)).not.toBeNull();
    expect(knowledgeBaseRedirect("last session 187d787b-acb3-4ce6-bfdc-60ccf669eb2c", katya)).not.toBeNull();
  });
  it("не мешает справочным запросам", () => {
    expect(knowledgeBaseRedirect("техники КПТ при тревоге", katya)).toBeNull();
    expect(knowledgeBaseRedirect("как сменить часовой пояс", katya)).toBeNull();
    expect(knowledgeBaseRedirect("последней сессии", [])).toBeNull();
  });
});

describe("knowledgeBaseRedirect: вопросы «что говорила»", () => {
  const katya = [{ id: "k1", name: "Катя Синицына" }];
  it("перенаправляет", () => {
    expect(knowledgeBaseRedirect("как узнать, что говорили о родственниках", katya)).not.toBeNull();
    expect(knowledgeBaseRedirect("что рассказывала клиентка про маму", katya)).not.toBeNull();
  });
});

import { unknownNamesInMessage } from "../mentionedClients";

describe("unknownNamesInMessage", () => {
  const cl = [{ id: "1", name: "Катя Синицына" }, { id: "2", name: "Анна Тестова" }];
  it("находит фамилию, которой нет среди клиентов", () => {
    expect(unknownNamesInMessage("Что было на последней сессии с Петровым?", cl)).toEqual(["Петровым"]);
  });
  it("не трогает известных клиентов, аббревиатуры и начало предложения", () => {
    expect(unknownNamesInMessage("Что было на последней сессии с Катей?", cl)).toEqual([]);
    expect(unknownNamesInMessage("У Анны тревога. Это ГТР?", cl)).toEqual([]);
    expect(unknownNamesInMessage("А про мужа?", cl)).toEqual([]);
  });
});
