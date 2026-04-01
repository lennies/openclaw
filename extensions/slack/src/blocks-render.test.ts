import { describe, expect, it } from "vitest";
import {
  buildQuickChartImageUrl,
  buildSlackAnalyticsBlocks,
  buildSlackChartBlocks,
  buildSlackKpiBlocks,
  buildSlackNativeTableBlocks,
  buildSlackTableBlocks,
  buildSlackTableSectionBlocks,
} from "./blocks-render.js";

describe("buildSlackKpiBlocks", () => {
  it("renders KPI values into Slack section fields", () => {
    const blocks = buildSlackKpiBlocks({
      title: "Weekly KPIs",
      kpis: [
        { label: "DAU", value: "4,321", delta: "+12% WoW", trend: "up" },
        { label: "Placements", value: 18, context: "Net of cancels" },
      ],
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: { type: "mrkdwn", text: "*Weekly KPIs*" },
    });
    expect(blocks[1]).toMatchObject({
      type: "section",
      fields: expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining("*4,321*") }),
        expect.objectContaining({ text: expect.stringContaining("Placements") }),
      ]),
    });
  });
});

describe("buildSlackTableSectionBlocks", () => {
  it("renders rows into monospace section blocks", () => {
    const blocks = buildSlackTableSectionBlocks({
      title: "Top Specialties",
      rows: [
        { specialty: "ICU", pqls: 42, placements: 7 },
        { specialty: "ER", pqls: 35, placements: 5 },
      ],
      columns: [
        { key: "specialty", label: "Specialty" },
        { key: "pqls", label: "PQLs", align: "right" },
        { key: "placements", label: "Placements", align: "right" },
      ],
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: { type: "mrkdwn", text: "*Top Specialties*" },
    });
    expect(blocks[1]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("```"),
      },
    });
    expect((blocks[1] as { text?: { text?: string } }).text?.text).toContain("ICU");
    expect((blocks[1] as { text?: { text?: string } }).text?.text).toContain("Placements");
  });

  it("returns a friendly empty state when no rows are present", () => {
    const blocks = buildSlackTableSectionBlocks({
      title: "Offers",
      rows: [],
    });

    expect(blocks).toHaveLength(2);
    expect((blocks[1] as { text?: { text?: string } }).text?.text).toContain("No rows to display");
  });
});

describe("buildSlackTableBlocks", () => {
  it("prefers native Slack table blocks for compact tables", () => {
    const blocks = buildSlackTableBlocks({
      title: "Top Specialties",
      rows: [
        { specialty: "ICU", pqls: 42, placements: 7 },
        { specialty: "ER", pqls: 35, placements: 5 },
      ],
      columns: [
        { key: "specialty", label: "Specialty" },
        { key: "pqls", label: "PQLs", align: "right" },
        { key: "placements", label: "Placements", align: "right" },
      ],
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: { type: "mrkdwn", text: "*Top Specialties*" },
    });
    expect(blocks[1]).toMatchObject({
      type: "table",
      column_settings: [{ align: "left" }, { align: "right" }, { align: "right" }],
    });
    expect(buildSlackNativeTableBlocks({ rows: [{ specialty: "ICU" }] })?.[0]).toMatchObject({
      type: "table",
    });
  });

  it("falls back to monospace sections when the native table exceeds Slack limits", () => {
    const blocks = buildSlackTableBlocks({
      title: "Wide table",
      rows: Array.from({ length: 100 }, (_, index) => ({ row: index + 1, value: index + 10 })),
      columns: [
        { key: "row", label: "Row" },
        { key: "value", label: "Value", align: "right" },
      ],
    });

    expect(blocks[1]).toMatchObject({
      type: "section",
      text: { text: expect.stringContaining("```") },
    });
  });
});

describe("chart helpers", () => {
  it("builds QuickChart URLs and image blocks", () => {
    const url = buildQuickChartImageUrl({
      title: "Offer trend",
      config: {
        type: "line",
        data: {
          labels: ["W1", "W2"],
          datasets: [{ label: "Offers", data: [10, 14] }],
        },
      },
      width: 800,
      height: 400,
    });

    expect(url).toContain("https://quickchart.io/chart?");
    expect(decodeURIComponent(url)).toContain('"type":"line"');

    const blocks = buildSlackChartBlocks({
      title: "Offer trend",
      altText: "Line chart of weekly offers",
      config: { type: "bar", data: { labels: ["A"], datasets: [{ data: [1] }] } },
    });

    expect(blocks).toEqual([
      expect.objectContaining({ type: "section" }),
      expect.objectContaining({
        type: "image",
        alt_text: "Line chart of weekly offers",
        image_url: expect.stringContaining("quickchart.io/chart"),
      }),
    ]);
  });
});

describe("buildSlackAnalyticsBlocks", () => {
  it("combines intro, KPIs, table, and chart blocks", () => {
    const blocks = buildSlackAnalyticsBlocks({
      intro: "Marketplace weekly snapshot",
      kpis: { DAU: "4,321", Placements: 18 },
      table: {
        title: "Top facilities",
        rows: [{ facility: "General", offers: 12 }],
      },
      chart: {
        title: "Offers by week",
        config: { type: "line", data: { labels: ["W1"], datasets: [{ data: [12] }] } },
      },
    });

    expect(blocks?.length).toBeGreaterThan(4);
    expect((blocks?.[0] as { text?: { text?: string } }).text?.text).toContain(
      "Marketplace weekly snapshot",
    );
    expect(blocks?.some((block) => (block as { type?: string }).type === "table")).toBe(true);
    expect(blocks?.some((block) => (block as { type?: string }).type === "image")).toBe(true);
  });
});
