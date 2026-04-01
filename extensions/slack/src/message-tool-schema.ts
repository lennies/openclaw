import { Type } from "@sinclair/typebox";

export function createSlackMessageToolBlocksSchema() {
  return Type.Array(
    Type.Object(
      {},
      {
        additionalProperties: true,
        description: "Slack Block Kit payload blocks (Slack only).",
      },
    ),
  );
}

export function createSlackMessageToolKpisSchema() {
  return Type.Union([
    Type.Array(
      Type.Object(
        {
          label: Type.String(),
          value: Type.Optional(Type.Any()),
          delta: Type.Optional(Type.Any()),
          context: Type.Optional(Type.Any()),
          trend: Type.Optional(
            Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("neutral")]),
          ),
        },
        {
          additionalProperties: false,
          description: "Structured KPI cards rendered into Slack section fields.",
        },
      ),
    ),
    Type.Record(Type.String(), Type.Any(), {
      description: "Key/value KPI map rendered into Slack KPI blocks.",
    }),
  ]);
}

export function createSlackMessageToolTableSchema() {
  return Type.Object(
    {
      title: Type.Optional(Type.String()),
      rows: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
      columns: Type.Optional(
        Type.Array(
          Type.Union([
            Type.String(),
            Type.Object(
              {
                key: Type.String(),
                label: Type.Optional(Type.String()),
                align: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right")])),
              },
              { additionalProperties: false },
            ),
          ]),
        ),
      ),
      emptyText: Type.Optional(Type.String()),
      maxRows: Type.Optional(Type.Number()),
    },
    {
      additionalProperties: false,
      description:
        "Structured table data. Compact tables render as native Slack table blocks, with fallback to monospace sections when needed.",
    },
  );
}

export function createSlackMessageToolChartSchema() {
  return Type.Object(
    {
      title: Type.Optional(Type.String()),
      altText: Type.Optional(Type.String()),
      config: Type.Any(),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      devicePixelRatio: Type.Optional(Type.Number()),
      backgroundColor: Type.Optional(Type.String()),
      format: Type.Optional(
        Type.Union([Type.Literal("png"), Type.Literal("webp"), Type.Literal("svg")]),
      ),
      version: Type.Optional(Type.String()),
    },
    {
      additionalProperties: false,
      description:
        "Chart.js / QuickChart-style config. Slack sendMessage uploads charts as files for better native display.",
    },
  );
}

export function createSlackMessageToolCanvasSchema() {
  return Type.Object(
    {
      title: Type.String(),
      content: Type.Optional(Type.String()),
      markdown: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      postLink: Type.Optional(Type.Boolean()),
      linkLabel: Type.Optional(Type.String()),
    },
    {
      additionalProperties: false,
      description:
        "Explicit Slack report export. Creates a canvas from markdown/content and posts a link back into Slack.",
    },
  );
}
