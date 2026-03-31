import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { parseSlackBlocksInput, SLACK_MAX_BLOCKS } from "./blocks-input.js";
import { buildSlackInteractiveBlocks, type SlackBlock } from "./blocks-render.js";

export function resolveSlackReplyBlocks(payload: ReplyPayload): SlackBlock[] | undefined {
  const slackData = payload.channelData?.slack;
  const interactiveBlocks = buildSlackInteractiveBlocks(payload.interactive);
  let channelBlocks: SlackBlock[] = [];
  if (slackData && typeof slackData === "object" && !Array.isArray(slackData)) {
    try {
      channelBlocks =
        (parseSlackBlocksInput((slackData as { blocks?: unknown }).blocks) as SlackBlock[]) ?? [];
    } catch (err) {
      logVerbose(`slack: invalid reply blocks ignored (${String(err)})`);
      channelBlocks = [];
    }
  }
  const blocks = [...channelBlocks, ...interactiveBlocks];
  if (blocks.length > SLACK_MAX_BLOCKS) {
    throw new Error(
      `Slack blocks cannot exceed ${SLACK_MAX_BLOCKS} items after interactive render`,
    );
  }
  return blocks.length > 0 ? blocks : undefined;
}
