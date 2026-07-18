import appCss from "../public/app.css?raw";
import appJs from "../public/app.js?raw";
import indexHtml from "../public/index.html?raw";
import {
  calculateDataSync,
  normaliseItemName,
  validateDailyRows,
  type ProductRecord,
} from "./profitability";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

interface Env {
  DB?: D1Database;
  PRODUCT_MASTER_JSON?: string;
  PRODUCT_MASTER_VERSION?: string;
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

const GITHUB_ORIGIN = "https://jrdermrz.github.io";

function apiHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = origin === GITHUB_ORIGIN ? origin : "";
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: apiHeaders(request) });
}

function parseProductMaster(value: string): ProductRecord[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Product master secret must be an array.");
  const latest = new Map<string, ProductRecord>();
  for (const raw of parsed) {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const itemName = String(record.itemName ?? "").trim();
    const itemKey = normaliseItemName(itemName);
    const rtsRate = Number(record.rtsRate);
    const cog = Number(record.cog);
    const effectiveDate = String(record.effectiveDate ?? "").trim();
    if (!itemKey || !Number.isFinite(rtsRate) || rtsRate < 0 || rtsRate > 100 || !Number.isFinite(cog) || cog < 0) continue;
    latest.set(itemKey, { itemName, itemKey, effectiveDate, rtsRate, cog });
  }
  return Array.from(latest.values());
}

async function ensureProductMaster(env: Env) {
  if (!env.DB) throw new Error("Database is unavailable.");
  const version = env.PRODUCT_MASTER_VERSION?.trim();
  const source = env.PRODUCT_MASTER_JSON;
  if (!version || !source) throw new Error("Product database has not been initialized.");
  const current = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind("product_master_version").first<{ value: string }>();
  if (current?.value === version) return;
  const products = parseProductMaster(source);
  if (!products.length) throw new Error("Product database has no valid records.");
  const statements = [env.DB.prepare("DELETE FROM product_master")];
  for (const product of products) {
    statements.push(env.DB.prepare("INSERT INTO product_master (effective_date, item_name, item_key, rts_rate, cog) VALUES (?, ?, ?, ?, ?)").bind(product.effectiveDate, product.itemName, product.itemKey, product.rtsRate, product.cog));
  }
  statements.push(env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind("product_master_version", version));
  await env.DB.batch(statements);
}

async function productRecords(env: Env) {
  if (!env.DB) throw new Error("Database is unavailable.");
  const query = await env.DB.prepare("SELECT effective_date AS effectiveDate, item_name AS itemName, item_key AS itemKey, rts_rate AS rtsRate, cog FROM product_master").all<ProductRecord>();
  return query.results;
}

async function storeDataSync(env: Env, uploadId: string, fileName: string, result: ReturnType<typeof calculateDataSync>) {
  if (!env.DB) throw new Error("Database is unavailable.");
  const uploadedAt = new Date().toISOString();
  const unmatchedRows = result.rowResults.length - result.matchedRows;
  await env.DB.prepare("INSERT INTO uploads (id, file_name, uploaded_at, row_count, matched_rows, unmatched_rows, total_ad_spend, total_orders, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(uploadId, fileName, uploadedAt, result.rowResults.length, result.matchedRows, unmatchedRows, result.adSpend, result.orders, unmatchedRows ? "unmatched_items" : "computed")
    .run();
  const statements = result.rowResults.map((entry, index) => env.DB!.prepare("INSERT INTO daily_rows (upload_id, row_number, date, page_name, item_name, item_key, ad_account, cpp, cpm, cod, ad_spend, orders, budget, spent_percent, rts_rate_used, cog_used, net_without_rts, net_with_rts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(uploadId, index + 1, entry.row.date, entry.row.pageName, entry.row.itemName, entry.row.itemKey, entry.row.adAccount, entry.row.cpp, entry.row.cpm, entry.row.cod, entry.row.adSpend, entry.row.orderQty, entry.row.budget, entry.row.spentPercent, entry.product?.rtsRate ?? null, entry.product?.cog ?? null, entry.netWithoutRts, entry.netWithRts));
  for (let start = 0; start < statements.length; start += 75) {
    await env.DB.batch(statements.slice(start, start + 75));
  }
  return uploadedAt;
}

async function dataSyncResponse(request: Request, env: Env) {
  if (!env.DB) return json(request, { error: "Database is unavailable." }, 503);
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > 2_000_000) return json(request, { error: "The uploaded data is too large." }, 413);
  const body = await request.json().catch(() => null) as { fileName?: unknown; rows?: unknown; dryRun?: unknown } | null;
  const rows = validateDailyRows(body?.rows);
  if (!rows.length) return json(request, { error: "No valid daily data rows were received." }, 400);
  await ensureProductMaster(env);
  const products = await productRecords(env);
  const result = calculateDataSync(rows, products);
  const { rowResults: _privateRows, ...publicResult } = result;
  if (body?.dryRun === true) {
    return json(request, { ...publicResult, uploadId: null, uploadedAt: null, storedRows: rows.length, dryRun: true });
  }
  const uploadId = crypto.randomUUID();
  const fileName = String(body?.fileName ?? "daily-data.xlsx").trim().slice(0, 180) || "daily-data.xlsx";
  const uploadedAt = await storeDataSync(env, uploadId, fileName, result);
  return json(request, { ...publicResult, uploadId, uploadedAt, storedRows: rows.length });
}

type EmbeddedAsset = {
  body: string;
  contentType: string;
};

const embeddedAssets = new Map<string, EmbeddedAsset>([
  ["/app.css", { body: appCss, contentType: "text/css; charset=utf-8" }],
  ["/app.js", { body: appJs, contentType: "text/javascript; charset=utf-8" }],
]);

function embeddedResponse(pathname: string): Response | null {
  const asset = embeddedAssets.get(pathname);
  if (!asset) return null;

  return new Response(asset.body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function pageResponse(origin: string): Response {
  return new Response(indexHtml.replaceAll("__SITE_ORIGIN__", origin), {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: apiHeaders(request) });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      try {
        await ensureProductMaster(env);
        const count = await env.DB!.prepare("SELECT COUNT(*) AS count FROM product_master").first<{ count: number }>();
        return json(request, { ok: true, productCount: count?.count ?? 0 });
      } catch (error) {
        return json(request, { ok: false, error: error instanceof Error ? error.message : "Database initialization failed." }, 503);
      }
    }

    if (url.pathname === "/api/data-sync" && request.method === "POST") {
      try {
        return await dataSyncResponse(request, env);
      } catch (error) {
        return json(request, { error: error instanceof Error ? error.message : "The data could not be processed." }, 500);
      }
    }

    if (url.pathname === "/health") {
      return new Response("ok", {
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
      });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return pageResponse(url.origin);
    }

    const pathname = url.pathname;
    const embedded = embeddedResponse(pathname);
    if (embedded) return embedded;

    if (env.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("PH E-commerce Profitability Calculator is temporarily unavailable. Please refresh.", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "10",
      },
    });
  },
};
