import { describe, expect, it } from "vitest";
import { createSlackEditTestClient, installSlackBlockTestMocks } from "./blocks.test-helpers.js";

installSlackBlockTestMocks();
const { createSlackCanvas, editSlackCanvas } = await import("./actions.js");

describe("Slack canvas actions", () => {
  it("creates canvases with create-time markdown content", async () => {
    const client = {
      ...createSlackEditTestClient(),
      apiCall: async (method: string, payload?: Record<string, unknown>) => {
        expect(method).toBe("canvases.create");
        expect(payload).toMatchObject({
          title: "Weekly report",
          document: {
            type: "markdown",
            markdown: "# Weekly report\n\nAll systems go.",
          },
        });
        return { canvas_id: "F123", permalink: "https://slack.com/docs/F123" };
      },
    };

    await expect(
      createSlackCanvas("Weekly report", "# Weekly report\n\nAll systems go.", {
        token: "xoxb-test",
        client: client as never,
      }),
    ).resolves.toEqual({
      canvasId: "F123",
      url: "https://slack.com/docs/F123",
      title: "Weekly report",
    });
  });

  it("wraps missing-scope errors with a friendly canvas message", async () => {
    const client = {
      ...createSlackEditTestClient(),
      apiCall: async () => {
        const err = new Error("missing_scope") as Error & {
          data?: { error?: string; needed?: string };
        };
        err.data = { error: "missing_scope", needed: "canvases:write" };
        throw err;
      },
    };

    await expect(
      createSlackCanvas("Weekly report", "hello", {
        token: "xoxb-test",
        client: client as never,
      }),
    ).rejects.toThrow(/canvas create requires the Slack app to include canvas scopes/i);
  });

  it("edits canvases with a single change payload", async () => {
    const client = {
      ...createSlackEditTestClient(),
      apiCall: async (method: string, payload?: Record<string, unknown>) => {
        expect(method).toBe("canvases.edit");
        expect(payload).toEqual({
          canvas_id: "F123",
          changes: [
            {
              operation: "insert_at_end",
              document_content: { type: "markdown", markdown: "Appended" },
            },
          ],
        });
        return { ok: true };
      },
    };

    await expect(
      editSlackCanvas(
        "F123",
        {
          operation: "insert_at_end",
          document_content: { type: "markdown", markdown: "Appended" },
        },
        {
          token: "xoxb-test",
          client: client as never,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
