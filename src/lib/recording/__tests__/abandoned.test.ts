import { describe, it, expect } from "vitest";
import { planTracksFromChunks } from "../abandoned";

describe("planTracksFromChunks", () => {
  it("строит заявленные дорожки по реестру", () => {
    const rows = [
      { track: "psychologist", sequence: 1, recording_attempt_id: "a" },
      { track: "psychologist", sequence: 0, recording_attempt_id: "a" },
      { track: "client", sequence: 0, recording_attempt_id: "a" },
    ];
    expect(planTracksFromChunks(rows)).toEqual([
      { role: "psychologist", chunkCount: 2, firstSequence: 0, lastSequence: 1 },
      { role: "client", chunkCount: 1, firstSequence: 0, lastSequence: 0 },
    ]);
  });
  it("пустой реестр — нет дорожек", () => {
    expect(planTracksFromChunks([])).toEqual([]);
  });
});
