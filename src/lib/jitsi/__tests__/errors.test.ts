import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFriendlyCallErrorMessage, makeJitsiCallError } from "../errors";

describe("getFriendlyCallErrorMessage", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("распознаёт lobby/membersOnly как понятное сообщение про комнату ожидания", () => {
    const err = makeJitsiCallError("Jitsi connection failed: conference.connectionError.membersOnly");
    expect(getFriendlyCallErrorMessage(err)).toMatch(/лобби/i);
  });

  it("распознаёт код через поле code, даже если message не содержит совпадения", () => {
    const err = makeJitsiCallError("какая-то непонятная ошибка", "connection.passwordRequired");
    expect(getFriendlyCallErrorMessage(err)).toMatch(/авторизоваться/i);
  });

  it("регистронезависима", () => {
    const err = makeJitsiCallError("CONFERENCE.CONNECTIONERROR.MEMBERSONLY");
    expect(getFriendlyCallErrorMessage(err)).toMatch(/лобби/i);
  });

  it("возвращает общий fallback для неизвестного кода и всё равно логирует сырую ошибку", () => {
    const err = makeJitsiCallError("something totally unrecognized happened");
    const result = getFriendlyCallErrorMessage(err);
    expect(result).toMatch(/Не удалось подключиться к звонку/i);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("не падает на не-Error значениях (строка, undefined)", () => {
    expect(() => getFriendlyCallErrorMessage("plain string error")).not.toThrow();
    expect(() => getFriendlyCallErrorMessage(undefined)).not.toThrow();
    expect(getFriendlyCallErrorMessage(undefined)).toMatch(/Не удалось подключиться к звонку/i);
  });

  it("первое совпадение по порядку списка побеждает (icefailed раньше othererror)", () => {
    const err = makeJitsiCallError("iceFailed and othererror both present");
    expect(getFriendlyCallErrorMessage(err)).toMatch(/интернет-соединение/i);
  });
});
