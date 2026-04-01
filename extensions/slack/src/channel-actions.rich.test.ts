import { describe, expect, it } from "vitest";
import { createSlackActions } from "./channel-actions.js";

describe("createSlackActions describeMessageTool", () => {
  it("advertises Slack rich helper schemas for send", () => {
    const adapter = createSlackActions("slack");
    const discovery = adapter.describeMessageTool?.({
      cfg: {
        channels: {
          slack: {
            botToken: "xoxb-test",
          },
        },
      } as never,
    });

    expect(discovery?.schema).toMatchObject({
      properties: {
        blocks: expect.anything(),
        kpis: expect.anything(),
        table: expect.anything(),
        chart: expect.anything(),
        canvas: expect.anything(),
      },
    });
  });
});
