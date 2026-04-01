import { describe, expect, it } from "vitest";
import { buildSlackBlocksFallbackText } from "./blocks-fallback.js";

describe("buildSlackBlocksFallbackText", () => {
  it("summarizes native table blocks when no section/header text exists", () => {
    expect(
      buildSlackBlocksFallbackText([
        {
          type: "table",
          rows: [
            [
              { type: "raw_text", text: "Col A" },
              { type: "raw_text", text: "Col B" },
            ],
            [
              { type: "raw_text", text: "1" },
              { type: "raw_text", text: "2" },
            ],
          ],
        },
      ] as never),
    ).toBe("Shared a table (1 row × 2 columns)");
  });
});
