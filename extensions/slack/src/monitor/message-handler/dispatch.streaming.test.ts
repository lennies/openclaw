import { describe, expect, it } from "vitest";
import { resolveSlackStreamingThreadHint } from "./dispatch.js";

describe("resolveSlackStreamingThreadHint", () => {
  it("keeps explicit thread targets when already present", () => {
    expect(
      resolveSlackStreamingThreadHint({
        replyToMode: "all",
        incomingThreadTs: "111.222",
        messageTs: "111.222",
        isThreadReply: true,
        isDirectMessage: true,
      }),
    ).toBe("111.222");
  });

  it("auto-threads direct messages for native streaming when no thread target exists", () => {
    expect(
      resolveSlackStreamingThreadHint({
        replyToMode: "off",
        incomingThreadTs: undefined,
        messageTs: "123.456",
        isThreadReply: false,
        isDirectMessage: true,
      }),
    ).toBe("123.456");
  });

  it("does not invent thread targets for non-DM messages", () => {
    expect(
      resolveSlackStreamingThreadHint({
        replyToMode: "off",
        incomingThreadTs: undefined,
        messageTs: "123.456",
        isThreadReply: false,
        isDirectMessage: false,
      }),
    ).toBeUndefined();
  });
});
