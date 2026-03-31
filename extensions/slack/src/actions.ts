import type { Block, KnownBlock, WebClient } from "@slack/web-api";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { resolveSlackAccount } from "./accounts.js";
import { buildSlackBlocksFallbackText } from "./blocks-fallback.js";
import { validateSlackBlocksArray } from "./blocks-input.js";
import { createSlackWebClient } from "./client.js";
import { resolveSlackMedia } from "./monitor/media.js";
import type { SlackMediaResult } from "./monitor/media.js";
import { sendMessageSlack } from "./send.js";
import { resolveSlackBotToken } from "./token.js";

export type SlackActionClientOpts = {
  accountId?: string;
  token?: string;
  client?: WebClient;
};

export type SlackMessageSummary = {
  ts?: string;
  text?: string;
  user?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{
    name?: string;
    count?: number;
    users?: string[];
  }>;
  /** File attachments on this message. Present when the message has files. */
  files?: Array<{
    id?: string;
    name?: string;
    mimetype?: string;
  }>;
};

export type SlackPin = {
  type?: string;
  message?: { ts?: string; text?: string };
  file?: { id?: string; name?: string };
};

export type SlackCanvasCreateResult = {
  canvasId: string;
  url?: string;
  title?: string;
};

export type SlackCanvasChange = Record<string, unknown>;

type SlackApiCallClient = WebClient & {
  apiCall: (method: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function resolveToken(explicit?: string, accountId?: string) {
  const cfg = loadConfig();
  const account = resolveSlackAccount({ cfg, accountId });
  const token = resolveSlackBotToken(explicit ?? account.botToken ?? undefined);
  if (!token) {
    logVerbose(
      `slack actions: missing bot token for account=${account.accountId} explicit=${Boolean(
        explicit,
      )} source=${account.botTokenSource ?? "unknown"}`,
    );
    throw new Error("SLACK_BOT_TOKEN or channels.slack.botToken is required for Slack actions");
  }
  return token;
}

function normalizeEmoji(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Emoji is required for Slack reactions");
  }
  return trimmed.replace(/^:+|:+$/g, "");
}

async function getClient(opts: SlackActionClientOpts = {}) {
  const token = resolveToken(opts.token, opts.accountId);
  return opts.client ?? createSlackWebClient(token);
}

async function resolveBotUserId(client: WebClient) {
  const auth = await client.auth.test();
  if (!auth?.user_id) {
    throw new Error("Failed to resolve Slack bot user id");
  }
  return auth.user_id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNestedString(value: unknown, keys: string[]): string | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : undefined;
}

function getSlackApiErrorCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) {
    return undefined;
  }
  const maybeData = err as Error & { data?: { error?: string } };
  const code = maybeData.data?.error;
  return typeof code === "string" && code.trim() ? code.trim().toLowerCase() : undefined;
}

function getSlackNeededScopes(err: unknown): string[] {
  if (!(err instanceof Error)) {
    return [];
  }
  const maybeData = err as Error & {
    data?: {
      needed?: string;
      response_metadata?: { scopes?: string[]; acceptedScopes?: string[] };
    };
  };
  const needed = typeof maybeData.data?.needed === "string" ? [maybeData.data.needed] : [];
  const metadata = [
    ...(maybeData.data?.response_metadata?.scopes ?? []),
    ...(maybeData.data?.response_metadata?.acceptedScopes ?? []),
  ];
  return [...needed, ...metadata].map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function createSlackCanvasScopeError(action: "create" | "edit", err: unknown): Error {
  const neededScopes = getSlackNeededScopes(err);
  const scopeHint = neededScopes.length > 0 ? ` Missing scopes: ${neededScopes.join(", ")}.` : "";
  return new Error(
    `Slack canvas ${action} requires the Slack app to include canvas scopes and be reinstalled in the workspace.${scopeHint}`,
  );
}

function normalizeSlackCanvasCreateResult(
  response: Record<string, unknown>,
  fallbackTitle: string,
): SlackCanvasCreateResult {
  const canvasId =
    readNestedString(response, ["canvas_id"]) ??
    readNestedString(response, ["canvas", "id"]) ??
    readNestedString(response, ["id"]);
  if (!canvasId) {
    throw new Error("Slack canvas create succeeded but did not return a canvas id");
  }
  const url =
    readNestedString(response, ["permalink"]) ??
    readNestedString(response, ["url"]) ??
    readNestedString(response, ["canvas", "permalink"]) ??
    readNestedString(response, ["canvas", "url"]);
  const title =
    readNestedString(response, ["title"]) ?? readNestedString(response, ["canvas", "title"]);
  return {
    canvasId,
    ...(url ? { url } : {}),
    title: title ?? fallbackTitle,
  };
}

export async function reactSlackMessage(
  channelId: string,
  messageId: string,
  emoji: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.reactions.add({
    channel: channelId,
    timestamp: messageId,
    name: normalizeEmoji(emoji),
  });
}

export async function removeSlackReaction(
  channelId: string,
  messageId: string,
  emoji: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.reactions.remove({
    channel: channelId,
    timestamp: messageId,
    name: normalizeEmoji(emoji),
  });
}

export async function removeOwnSlackReactions(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
): Promise<string[]> {
  const client = await getClient(opts);
  const userId = await resolveBotUserId(client);
  const reactions = await listSlackReactions(channelId, messageId, { client });
  const toRemove = new Set<string>();
  for (const reaction of reactions ?? []) {
    const name = reaction?.name;
    if (!name) {
      continue;
    }
    const users = reaction?.users ?? [];
    if (users.includes(userId)) {
      toRemove.add(name);
    }
  }
  if (toRemove.size === 0) {
    return [];
  }
  await Promise.all(
    Array.from(toRemove, (name) =>
      client.reactions.remove({
        channel: channelId,
        timestamp: messageId,
        name,
      }),
    ),
  );
  return Array.from(toRemove);
}

export async function listSlackReactions(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
): Promise<SlackMessageSummary["reactions"]> {
  const client = await getClient(opts);
  const result = await client.reactions.get({
    channel: channelId,
    timestamp: messageId,
    full: true,
  });
  const message = result.message as SlackMessageSummary | undefined;
  return message?.reactions ?? [];
}

export async function sendSlackMessage(
  to: string,
  content: string,
  opts: SlackActionClientOpts & {
    mediaUrl?: string;
    mediaLocalRoots?: readonly string[];
    threadTs?: string;
    uploadFileName?: string;
    uploadTitle?: string;
    blocks?: (Block | KnownBlock)[];
  } = {},
) {
  return await sendMessageSlack(to, content, {
    accountId: opts.accountId,
    token: opts.token,
    mediaUrl: opts.mediaUrl,
    mediaLocalRoots: opts.mediaLocalRoots,
    client: opts.client,
    threadTs: opts.threadTs,
    ...(opts.uploadFileName ? { uploadFileName: opts.uploadFileName } : {}),
    ...(opts.uploadTitle ? { uploadTitle: opts.uploadTitle } : {}),
    blocks: opts.blocks,
  });
}

export async function editSlackMessage(
  channelId: string,
  messageId: string,
  content: string,
  opts: SlackActionClientOpts & { blocks?: (Block | KnownBlock)[] } = {},
) {
  const client = await getClient(opts);
  const blocks = opts.blocks == null ? undefined : validateSlackBlocksArray(opts.blocks);
  const trimmedContent = content.trim();
  await client.chat.update({
    channel: channelId,
    ts: messageId,
    text: trimmedContent || (blocks ? buildSlackBlocksFallbackText(blocks) : " "),
    ...(blocks ? { blocks } : {}),
  });
}

export async function createSlackCanvas(
  title: string,
  content: string,
  opts: SlackActionClientOpts = {},
): Promise<SlackCanvasCreateResult> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error("Slack canvas title is required");
  }

  const client = (await getClient(opts)) as SlackApiCallClient;
  try {
    const response = await client.apiCall("canvases.create", {
      title: trimmedTitle,
      document: {
        type: "markdown",
        markdown: content.trim() || " ",
      },
    });
    return normalizeSlackCanvasCreateResult(
      response as unknown as Record<string, unknown>,
      trimmedTitle,
    );
  } catch (err) {
    if (getSlackApiErrorCode(err) === "missing_scope") {
      throw createSlackCanvasScopeError("create", err);
    }
    throw err;
  }
}

export async function editSlackCanvas(
  canvasId: string,
  change: SlackCanvasChange,
  opts: SlackActionClientOpts = {},
): Promise<void> {
  const trimmedCanvasId = canvasId.trim();
  if (!trimmedCanvasId) {
    throw new Error("Slack canvas id is required");
  }
  if (!isRecord(change) || Object.keys(change).length === 0) {
    throw new Error("Slack canvas edit requires a single non-empty change object");
  }

  const client = (await getClient(opts)) as SlackApiCallClient;
  try {
    await client.apiCall("canvases.edit", {
      canvas_id: trimmedCanvasId,
      changes: [change],
    });
  } catch (err) {
    if (getSlackApiErrorCode(err) === "missing_scope") {
      throw createSlackCanvasScopeError("edit", err);
    }
    throw err;
  }
}

export async function deleteSlackMessage(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.chat.delete({
    channel: channelId,
    ts: messageId,
  });
}

export async function readSlackMessages(
  channelId: string,
  opts: SlackActionClientOpts & {
    limit?: number;
    before?: string;
    after?: string;
    threadId?: string;
  } = {},
): Promise<{ messages: SlackMessageSummary[]; hasMore: boolean }> {
  const client = await getClient(opts);

  // Use conversations.replies for thread messages, conversations.history for channel messages.
  if (opts.threadId) {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: opts.threadId,
      limit: opts.limit,
      latest: opts.before,
      oldest: opts.after,
    });
    return {
      // conversations.replies includes the parent message; drop it for replies-only reads.
      messages: (result.messages ?? []).filter(
        (message) => (message as SlackMessageSummary)?.ts !== opts.threadId,
      ) as SlackMessageSummary[],
      hasMore: Boolean(result.has_more),
    };
  }

  const result = await client.conversations.history({
    channel: channelId,
    limit: opts.limit,
    latest: opts.before,
    oldest: opts.after,
  });
  return {
    messages: (result.messages ?? []) as SlackMessageSummary[],
    hasMore: Boolean(result.has_more),
  };
}

export async function getSlackMemberInfo(userId: string, opts: SlackActionClientOpts = {}) {
  const client = await getClient(opts);
  return await client.users.info({ user: userId });
}

export async function listSlackEmojis(opts: SlackActionClientOpts = {}) {
  const client = await getClient(opts);
  return await client.emoji.list();
}

export async function pinSlackMessage(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.pins.add({ channel: channelId, timestamp: messageId });
}

export async function unpinSlackMessage(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.pins.remove({ channel: channelId, timestamp: messageId });
}

export async function listSlackPins(
  channelId: string,
  opts: SlackActionClientOpts = {},
): Promise<SlackPin[]> {
  const client = await getClient(opts);
  const result = await client.pins.list({ channel: channelId });
  return (result.items ?? []) as SlackPin[];
}

type SlackFileInfoSummary = {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
  channels?: unknown;
  groups?: unknown;
  ims?: unknown;
  shares?: unknown;
};

type SlackFileThreadShare = {
  channelId: string;
  ts?: string;
  threadTs?: string;
};

function normalizeSlackScopeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function collectSlackDirectShareChannelIds(file: SlackFileInfoSummary): Set<string> {
  const ids = new Set<string>();
  for (const group of [file.channels, file.groups, file.ims]) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const entry of group) {
      if (typeof entry !== "string") {
        continue;
      }
      const normalized = normalizeSlackScopeValue(entry);
      if (normalized) {
        ids.add(normalized);
      }
    }
  }
  return ids;
}

function collectSlackShareMaps(file: SlackFileInfoSummary): Array<Record<string, unknown>> {
  if (!file.shares || typeof file.shares !== "object" || Array.isArray(file.shares)) {
    return [];
  }
  const shares = file.shares as Record<string, unknown>;
  return [shares.public, shares.private].filter(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
}

function collectSlackSharedChannelIds(file: SlackFileInfoSummary): Set<string> {
  const ids = new Set<string>();
  for (const shareMap of collectSlackShareMaps(file)) {
    for (const channelId of Object.keys(shareMap)) {
      const normalized = normalizeSlackScopeValue(channelId);
      if (normalized) {
        ids.add(normalized);
      }
    }
  }
  return ids;
}

function collectSlackThreadShares(
  file: SlackFileInfoSummary,
  channelId: string,
): SlackFileThreadShare[] {
  const matches: SlackFileThreadShare[] = [];
  for (const shareMap of collectSlackShareMaps(file)) {
    const rawEntries = shareMap[channelId];
    if (!Array.isArray(rawEntries)) {
      continue;
    }
    for (const rawEntry of rawEntries) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        continue;
      }
      const entry = rawEntry as Record<string, unknown>;
      const ts = typeof entry.ts === "string" ? normalizeSlackScopeValue(entry.ts) : undefined;
      const threadTs =
        typeof entry.thread_ts === "string" ? normalizeSlackScopeValue(entry.thread_ts) : undefined;
      matches.push({ channelId, ts, threadTs });
    }
  }
  return matches;
}

function hasSlackScopeMismatch(params: {
  file: SlackFileInfoSummary;
  channelId?: string;
  threadId?: string;
}): boolean {
  const channelId = normalizeSlackScopeValue(params.channelId);
  if (!channelId) {
    return false;
  }
  const threadId = normalizeSlackScopeValue(params.threadId);

  const directIds = collectSlackDirectShareChannelIds(params.file);
  const sharedIds = collectSlackSharedChannelIds(params.file);
  const hasChannelEvidence = directIds.size > 0 || sharedIds.size > 0;
  const inChannel = directIds.has(channelId) || sharedIds.has(channelId);
  if (hasChannelEvidence && !inChannel) {
    return true;
  }

  if (!threadId) {
    return false;
  }
  const threadShares = collectSlackThreadShares(params.file, channelId);
  if (threadShares.length === 0) {
    return false;
  }
  const threadEvidence = threadShares.filter((entry) => entry.threadTs || entry.ts);
  if (threadEvidence.length === 0) {
    return false;
  }
  return !threadEvidence.some((entry) => entry.threadTs === threadId || entry.ts === threadId);
}

/**
 * Downloads a Slack file by ID and saves it to the local media store.
 * Fetches a fresh download URL via files.info to avoid using stale private URLs.
 * Returns null when the file cannot be found or downloaded.
 */
export async function downloadSlackFile(
  fileId: string,
  opts: SlackActionClientOpts & { maxBytes: number; channelId?: string; threadId?: string },
): Promise<SlackMediaResult | null> {
  const token = resolveToken(opts.token, opts.accountId);
  const client = await getClient(opts);

  // Fetch fresh file metadata (includes a current url_private_download).
  const info = await client.files.info({ file: fileId });
  const file = info.file as SlackFileInfoSummary | undefined;

  if (!file?.url_private_download && !file?.url_private) {
    return null;
  }
  if (hasSlackScopeMismatch({ file, channelId: opts.channelId, threadId: opts.threadId })) {
    return null;
  }

  const results = await resolveSlackMedia({
    files: [
      {
        id: file.id,
        name: file.name,
        mimetype: file.mimetype,
        url_private: file.url_private,
        url_private_download: file.url_private_download,
      },
    ],
    token,
    maxBytes: opts.maxBytes,
  });

  return results?.[0] ?? null;
}
