import type { Block, KnownBlock } from "@slack/web-api";
import { reduceInteractiveReply } from "openclaw/plugin-sdk/interactive-runtime";
import type { InteractiveReply } from "openclaw/plugin-sdk/interactive-runtime";
import { validateSlackBlocksArray } from "./blocks-input.js";
import { truncateSlackText } from "./truncate.js";

export const SLACK_REPLY_BUTTON_ACTION_ID = "openclaw:reply_button";
export const SLACK_REPLY_SELECT_ACTION_ID = "openclaw:reply_select";
const SLACK_SECTION_TEXT_MAX = 3000;
const SLACK_SECTION_FIELD_MAX = 2000;
const SLACK_PLAIN_TEXT_MAX = 75;
const SLACK_MAX_BLOCKS = 50;
const SLACK_MAX_TABLE_COLUMN_WIDTH = 24;
const SLACK_MAX_TABLE_CELL_CHARS = 48;
const SLACK_NATIVE_TABLE_MAX_COLUMNS = 20;
const SLACK_NATIVE_TABLE_MAX_ROWS = 100;
const QUICKCHART_BASE_URL = "https://quickchart.io/chart";

export type SlackBlock = Block | KnownBlock;

function buildSlackReplyButtonActionId(buttonIndex: number, choiceIndex: number): string {
  return `${SLACK_REPLY_BUTTON_ACTION_ID}:${String(buttonIndex)}:${String(choiceIndex + 1)}`;
}

function buildSlackReplySelectActionId(selectIndex: number): string {
  return `${SLACK_REPLY_SELECT_ACTION_ID}:${String(selectIndex)}`;
}

function resolveSlackButtonStyle(
  style: "primary" | "secondary" | "success" | "danger" | undefined,
) {
  if (style === "primary" || style === "danger") {
    return style;
  }
  if (style === "success") {
    return "primary";
  }
  return undefined;
}

export type SlackKpiInput = {
  label: string;
  value: string | number | boolean | null | undefined;
  delta?: string | number | boolean | null | undefined;
  context?: string | number | boolean | null | undefined;
  trend?: "up" | "down" | "neutral";
};

export type SlackKpiCollection = SlackKpiInput[] | Record<string, unknown>;

export type SlackTableColumn =
  | string
  | {
      key: string;
      label?: string;
      align?: "left" | "right";
    };

export type SlackTableRow = Record<string, unknown>;

export type SlackTableRenderInput = {
  title?: string;
  rows?: SlackTableRow[];
  columns?: SlackTableColumn[];
  emptyText?: string;
  maxRows?: number;
};

export type SlackChartRenderInput = {
  title?: string;
  altText?: string;
  config: unknown;
  width?: number;
  height?: number;
  devicePixelRatio?: number;
  backgroundColor?: string;
  format?: "png" | "webp" | "svg";
  version?: string;
};

export type SlackAnalyticsRenderInput = {
  intro?: string;
  kpis?: SlackKpiCollection;
  table?: SlackTableRenderInput;
  chart?: SlackChartRenderInput;
};

function isSlackRenderableScalar(
  value: unknown,
): value is string | number | boolean | null | undefined {
  return (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function createSlackSectionBlock(text: string): SlackBlock {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: truncateSlackText(text, SLACK_SECTION_TEXT_MAX),
    },
  };
}

function normalizeRenderableValue(value: unknown): string {
  if (value == null) {
    return "—";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "—";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return JSON.stringify(value) ?? String(value);
}

function createSlackEmptyStateBlocks(title: string | undefined, emptyText: string): SlackBlock[] {
  const blocks = [
    ...(title?.trim()
      ? [createSlackSectionBlock(`*${truncateSlackText(title.trim(), 120)}*`)]
      : []),
    createSlackSectionBlock(`_${truncateSlackText(emptyText, 300)}_`),
  ];
  return validateSlackBlocksArray(blocks) as SlackBlock[];
}

function pushValidatedBlock(blocks: SlackBlock[], block: SlackBlock): boolean {
  if (blocks.length >= SLACK_MAX_BLOCKS) {
    return false;
  }
  blocks.push(block);
  return true;
}

function appendTruncationNotice(blocks: SlackBlock[], label: string) {
  const notice = createSlackSectionBlock(`_${label} truncated to fit Slack block limits._`);
  if (blocks.length < SLACK_MAX_BLOCKS) {
    blocks.push(notice);
    return;
  }
  blocks[blocks.length - 1] = notice;
}

function normalizeKpis(kpis?: SlackKpiCollection): SlackKpiInput[] {
  if (!kpis) {
    return [];
  }
  if (Array.isArray(kpis)) {
    return kpis
      .filter((entry): entry is SlackKpiInput => Boolean(entry && typeof entry === "object"))
      .map((entry) => ({
        label: truncateSlackText(normalizeRenderableValue(entry.label), 80),
        value: entry.value,
        delta: entry.delta,
        context: entry.context,
        trend: entry.trend,
      }))
      .filter((entry) => entry.label && entry.label !== "—");
  }
  if (typeof kpis === "object") {
    return Object.entries(kpis).map(([label, value]) => ({
      label,
      value: isSlackRenderableScalar(value) ? value : (JSON.stringify(value) ?? String(value)),
    }));
  }
  return [];
}

function normalizeTableColumns(rows: SlackTableRow[], columns?: SlackTableColumn[]) {
  if (Array.isArray(columns) && columns.length > 0) {
    return columns
      .map((entry) =>
        typeof entry === "string"
          ? { key: entry, label: entry, align: "left" as const }
          : {
              key: entry.key,
              label: entry.label?.trim() || entry.key,
              align: entry.align === "right" ? ("right" as const) : ("left" as const),
            },
      )
      .filter((entry) => entry.key.trim().length > 0);
  }

  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key.trim()) {
        keys.add(key);
      }
    }
  }

  return Array.from(keys, (key) => ({ key, label: key, align: "left" as const }));
}

function normalizeTableCell(value: unknown): string {
  return truncateSlackText(
    normalizeRenderableValue(value)
      .replace(/\s*\n\s*/g, " / ")
      .replace(/`/g, "'"),
    SLACK_MAX_TABLE_CELL_CHARS,
  );
}

function padSlackTableCell(value: string, width: number, align: "left" | "right") {
  return align === "right" ? value.padStart(width, " ") : value.padEnd(width, " ");
}

function buildTableCodeBlockText(lines: string[]): string {
  return `\`\`\`\n${lines.join("\n")}\n\`\`\``;
}

export function buildSlackInteractiveBlocks(interactive?: InteractiveReply): SlackBlock[] {
  const initialState = {
    blocks: [] as SlackBlock[],
    buttonIndex: 0,
    selectIndex: 0,
  };
  return reduceInteractiveReply(interactive, initialState, (state, block) => {
    if (block.type === "text") {
      const trimmed = block.text.trim();
      if (!trimmed) {
        return state;
      }
      state.blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncateSlackText(trimmed, SLACK_SECTION_TEXT_MAX),
        },
      });
      return state;
    }
    if (block.type === "buttons") {
      if (block.buttons.length === 0) {
        return state;
      }
      state.blocks.push({
        type: "actions",
        block_id: `openclaw_reply_buttons_${++state.buttonIndex}`,
        elements: block.buttons.map((button, choiceIndex) => {
          const style = resolveSlackButtonStyle(button.style);
          return {
            type: "button",
            action_id: buildSlackReplyButtonActionId(state.buttonIndex, choiceIndex),
            text: {
              type: "plain_text",
              text: truncateSlackText(button.label, SLACK_PLAIN_TEXT_MAX),
              emoji: true,
            },
            value: button.value,
            ...(style ? { style } : {}),
          };
        }),
      });
      return state;
    }
    if (block.options.length === 0) {
      return state;
    }
    state.blocks.push({
      type: "actions",
      block_id: `openclaw_reply_select_${++state.selectIndex}`,
      elements: [
        {
          type: "static_select",
          action_id: buildSlackReplySelectActionId(state.selectIndex),
          placeholder: {
            type: "plain_text",
            text: truncateSlackText(
              block.placeholder?.trim() || "Choose an option",
              SLACK_PLAIN_TEXT_MAX,
            ),
            emoji: true,
          },
          options: block.options.map((option) => ({
            text: {
              type: "plain_text",
              text: truncateSlackText(option.label, SLACK_PLAIN_TEXT_MAX),
              emoji: true,
            },
            value: option.value,
          })),
        },
      ],
    });
    return state;
  }).blocks;
}

export function buildSlackKpiBlocks(params: {
  title?: string;
  kpis?: SlackKpiCollection;
  emptyText?: string;
}): SlackBlock[] {
  const normalized = normalizeKpis(params.kpis);
  if (normalized.length === 0) {
    return createSlackEmptyStateBlocks(
      params.title,
      params.emptyText?.trim() || "No KPI data available.",
    );
  }

  const blocks: SlackBlock[] = [];
  if (params.title?.trim()) {
    pushValidatedBlock(
      blocks,
      createSlackSectionBlock(`*${truncateSlackText(params.title.trim(), 120)}*`),
    );
  }

  for (let index = 0; index < normalized.length; index += 10) {
    const slice = normalized.slice(index, index + 10);
    pushValidatedBlock(blocks, {
      type: "section",
      fields: slice.map((kpi) => {
        const value = truncateSlackText(normalizeRenderableValue(kpi.value), 80);
        const label = truncateSlackText(kpi.label, 80);
        const delta = kpi.delta == null ? "" : normalizeRenderableValue(kpi.delta);
        const context = kpi.context == null ? "" : normalizeRenderableValue(kpi.context);
        const trend =
          kpi.trend === "up"
            ? "📈 "
            : kpi.trend === "down"
              ? "📉 "
              : kpi.trend === "neutral"
                ? "➖ "
                : "";
        const fieldText = [
          `*${value}*`,
          label,
          delta ? `${trend}${delta}` : "",
          context ? `_${context}_` : "",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          type: "mrkdwn",
          text: truncateSlackText(fieldText, SLACK_SECTION_FIELD_MAX),
        };
      }),
    });
  }

  return validateSlackBlocksArray(blocks) as SlackBlock[];
}

export function buildSlackTableSectionBlocks(params: SlackTableRenderInput): SlackBlock[] {
  const rows = Array.isArray(params.rows) ? params.rows.filter(Boolean) : [];
  const limitedRows =
    typeof params.maxRows === "number" && params.maxRows > 0 ? rows.slice(0, params.maxRows) : rows;

  if (limitedRows.length === 0) {
    return createSlackEmptyStateBlocks(
      params.title,
      params.emptyText?.trim() || "No rows to display.",
    );
  }

  const columns = normalizeTableColumns(limitedRows, params.columns);
  if (columns.length === 0) {
    return createSlackEmptyStateBlocks(
      params.title,
      params.emptyText?.trim() || "No columns to display.",
    );
  }

  const widths = columns.map(({ key, label }) => {
    const candidateWidth = Math.max(
      label.length,
      ...limitedRows.map((row) => normalizeTableCell(row[key]).length),
    );
    return Math.min(candidateWidth, SLACK_MAX_TABLE_COLUMN_WIDTH);
  });

  const headerLine = columns
    .map((column, index) =>
      padSlackTableCell(
        truncateSlackText(column.label, widths[index]),
        widths[index],
        column.align,
      ),
    )
    .join(" | ");
  const dividerLine = widths.map((width) => "-".repeat(width)).join("-+-");
  const rowLines = limitedRows.map((row) =>
    columns
      .map((column, index) => {
        const cell = truncateSlackText(normalizeTableCell(row[column.key]), widths[index]);
        return padSlackTableCell(cell, widths[index], column.align);
      })
      .join(" | "),
  );

  const blocks: SlackBlock[] = [];
  if (params.title?.trim()) {
    pushValidatedBlock(
      blocks,
      createSlackSectionBlock(`*${truncateSlackText(params.title.trim(), 120)}*`),
    );
  }

  let renderedRows = 0;
  const maxContentLength = SLACK_SECTION_TEXT_MAX - 8;
  while (renderedRows < rowLines.length && blocks.length < SLACK_MAX_BLOCKS) {
    const chunkLines = [headerLine, dividerLine];
    while (renderedRows < rowLines.length) {
      const nextLines = [...chunkLines, rowLines[renderedRows]];
      const candidateText = buildTableCodeBlockText(nextLines);
      if (candidateText.length > SLACK_SECTION_TEXT_MAX && chunkLines.length > 2) {
        break;
      }
      if (candidateText.length > SLACK_SECTION_TEXT_MAX) {
        chunkLines.push(truncateSlackText(rowLines[renderedRows], maxContentLength));
        renderedRows += 1;
        break;
      }
      chunkLines.push(rowLines[renderedRows]);
      renderedRows += 1;
    }

    if (!pushValidatedBlock(blocks, createSlackSectionBlock(buildTableCodeBlockText(chunkLines)))) {
      break;
    }
  }

  if (renderedRows < rowLines.length || limitedRows.length < rows.length) {
    appendTruncationNotice(blocks, params.title?.trim() || "Table");
  }

  return validateSlackBlocksArray(blocks) as SlackBlock[];
}

function canRenderNativeSlackTable(params: {
  columns: Array<{ key: string; label: string; align: "left" | "right" }>;
  rows: SlackTableRow[];
}): boolean {
  return (
    params.columns.length > 0 &&
    params.columns.length <= SLACK_NATIVE_TABLE_MAX_COLUMNS &&
    params.rows.length + 1 <= SLACK_NATIVE_TABLE_MAX_ROWS
  );
}

function createSlackRawTextCell(text: string) {
  return {
    type: "raw_text" as const,
    text: truncateSlackText(text, SLACK_MAX_TABLE_CELL_CHARS),
  };
}

export function buildSlackNativeTableBlocks(
  params: SlackTableRenderInput,
): SlackBlock[] | undefined {
  const rows = Array.isArray(params.rows) ? params.rows.filter(Boolean) : [];
  const limitedRows =
    typeof params.maxRows === "number" && params.maxRows > 0 ? rows.slice(0, params.maxRows) : rows;

  if (limitedRows.length === 0) {
    return createSlackEmptyStateBlocks(
      params.title,
      params.emptyText?.trim() || "No rows to display.",
    );
  }

  const columns = normalizeTableColumns(limitedRows, params.columns);
  if (!canRenderNativeSlackTable({ columns, rows: limitedRows })) {
    return undefined;
  }

  const blocks: SlackBlock[] = [];
  if (params.title?.trim()) {
    pushValidatedBlock(
      blocks,
      createSlackSectionBlock(`*${truncateSlackText(params.title.trim(), 120)}*`),
    );
  }

  pushValidatedBlock(blocks, {
    type: "table",
    rows: [
      columns.map((column) => createSlackRawTextCell(column.label)),
      ...limitedRows.map((row) =>
        columns.map((column) => createSlackRawTextCell(normalizeTableCell(row[column.key]))),
      ),
    ],
    column_settings: columns.map((column) => ({
      align: column.align,
      is_wrapped: true,
    })),
  });

  if (limitedRows.length < rows.length) {
    appendTruncationNotice(blocks, params.title?.trim() || "Table");
  }

  return validateSlackBlocksArray(blocks) as SlackBlock[];
}

export function buildSlackTableBlocks(params: SlackTableRenderInput): SlackBlock[] {
  return buildSlackNativeTableBlocks(params) ?? buildSlackTableSectionBlocks(params);
}

export function buildQuickChartImageUrl(params: SlackChartRenderInput): string {
  const search = new URLSearchParams();
  const config = typeof params.config === "string" ? params.config : JSON.stringify(params.config);
  search.set("c", config);
  if (typeof params.width === "number" && Number.isFinite(params.width)) {
    search.set("w", String(Math.round(params.width)));
  }
  if (typeof params.height === "number" && Number.isFinite(params.height)) {
    search.set("h", String(Math.round(params.height)));
  }
  if (typeof params.devicePixelRatio === "number" && Number.isFinite(params.devicePixelRatio)) {
    search.set("devicePixelRatio", String(params.devicePixelRatio));
  }
  if (params.backgroundColor?.trim()) {
    search.set("backgroundColor", params.backgroundColor.trim());
  }
  if (params.format?.trim()) {
    search.set("format", params.format.trim());
  }
  if (params.version?.trim()) {
    search.set("v", params.version.trim());
  }
  return `${QUICKCHART_BASE_URL}?${search.toString()}`;
}

export function buildSlackChartBlocks(params: SlackChartRenderInput): SlackBlock[] {
  const altText = params.altText?.trim() || params.title?.trim() || "Chart";
  const blocks: SlackBlock[] = [
    ...(params.title?.trim()
      ? [createSlackSectionBlock(`*${truncateSlackText(params.title.trim(), 120)}*`)]
      : []),
    {
      type: "image",
      image_url: buildQuickChartImageUrl(params),
      alt_text: truncateSlackText(altText, 2000),
    },
  ];
  return validateSlackBlocksArray(blocks) as SlackBlock[];
}

export function buildSlackAnalyticsBlocks(
  params: SlackAnalyticsRenderInput,
): SlackBlock[] | undefined {
  const blocks: SlackBlock[] = [];
  if (params.intro?.trim()) {
    blocks.push(createSlackSectionBlock(params.intro.trim()));
  }
  if (params.kpis) {
    blocks.push(...buildSlackKpiBlocks({ title: "KPIs", kpis: params.kpis }));
  }
  if (params.table) {
    blocks.push(
      ...buildSlackTableBlocks({
        ...params.table,
        title: params.table.title ?? "Table",
      }),
    );
  }
  if (params.chart) {
    blocks.push(...buildSlackChartBlocks(params.chart));
  }
  if (blocks.length === 0) {
    return undefined;
  }
  const limited = blocks.slice(0, SLACK_MAX_BLOCKS);
  if (blocks.length > limited.length) {
    appendTruncationNotice(limited, "Analytics output");
  }
  return validateSlackBlocksArray(limited) as SlackBlock[];
}
