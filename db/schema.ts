import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const productMaster = sqliteTable(
  "product_master",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    effectiveDate: text("effective_date").notNull().default(""),
    itemName: text("item_name").notNull(),
    itemKey: text("item_key").notNull(),
    rtsRate: real("rts_rate").notNull(),
    cog: real("cog").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("product_master_item_effective_unique").on(table.itemKey, table.effectiveDate),
    index("product_master_item_key_idx").on(table.itemKey),
  ],
);

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  rowCount: integer("row_count").notNull(),
  matchedRows: integer("matched_rows").notNull().default(0),
  unmatchedRows: integer("unmatched_rows").notNull().default(0),
  totalAdSpend: real("total_ad_spend").notNull().default(0),
  totalOrders: integer("total_orders").notNull().default(0),
  status: text("status").notNull(),
});

export const dailyRows = sqliteTable(
  "daily_rows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uploadId: text("upload_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    date: text("date").notNull().default(""),
    pageName: text("page_name").notNull(),
    itemName: text("item_name").notNull(),
    itemKey: text("item_key").notNull(),
    adAccount: text("ad_account").notNull().default(""),
    cpp: real("cpp"),
    cpm: text("cpm").notNull().default(""),
    cod: real("cod").notNull(),
    adSpend: real("ad_spend").notNull(),
    orders: integer("orders").notNull(),
    budget: real("budget"),
    spentPercent: real("spent_percent"),
    rtsRateUsed: real("rts_rate_used"),
    cogUsed: real("cog_used"),
    netWithoutRts: real("net_without_rts"),
    netWithRts: real("net_with_rts"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("daily_rows_upload_id_idx").on(table.uploadId),
    index("daily_rows_item_key_idx").on(table.itemKey),
    index("daily_rows_date_idx").on(table.date),
  ],
);
