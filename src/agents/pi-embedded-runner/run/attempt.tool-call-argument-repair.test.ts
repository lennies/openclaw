import { describe, expect, it } from "vitest";
import { shouldRepairMalformedAnthropicToolCallArguments } from "./attempt.tool-call-argument-repair.js";

describe("shouldRepairMalformedAnthropicToolCallArguments", () => {
  it("enables the repair wrapper for native anthropic streams", () => {
    expect(shouldRepairMalformedAnthropicToolCallArguments("anthropic")).toBe(true);
  });

  it("keeps the repair wrapper enabled for kimi streams", () => {
    expect(shouldRepairMalformedAnthropicToolCallArguments("kimi")).toBe(true);
  });

  it("does not enable the repair wrapper for unrelated providers", () => {
    expect(shouldRepairMalformedAnthropicToolCallArguments("openai")).toBe(false);
  });
});
