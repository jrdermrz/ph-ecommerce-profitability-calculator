import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  calculateDataSync as calculateBackendDataSync,
  normaliseItemName as normaliseBackendItemName,
  validateDailyRows,
} from "../worker/profitability.ts";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(new Request("https://ph-ecommerce-profitability-calculator.example/"), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  });
}

test("server-renders the quick calculator and the next upload option", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const [html, css, app] = await Promise.all([
    response.text(),
    readFile(new URL("../public/app.css", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<title>PH E-commerce Profitability Calculator<\/title>/i);
  assert.match(html, /Quick Calculator/);
  assert.match(html, /Data Sync Calculator/);
  assert.match(html, /ARE YOU SURE YOU'RE/);
  assert.match(html, /PROFITABLE\?/);
  assert.match(html, /Your quick local e-commerce profitability calculator\./);
  assert.match(html, /COD price/);
  assert.match(html, /Order quantity/);
  assert.match(html, /COG per item/);
  assert.match(html, /Ad spend/);
  assert.match(html, /COD fee/);
  assert.match(html, /RTS rate/);
  assert.match(html, /Shipping fee per order/);
  assert.match(html, /12%/);
  assert.match(html, /Projected net without RTS/);
  assert.match(html, /Projected net with RTS/);
  assert.match(html, /Net Ratio/);
  assert.match(html, /NET PER PAGE/);
  assert.doesNotMatch(html, /Product master database|Upload RTS \+ COG master|Fixed calculation rules|Shipping per order/);
  assert.doesNotMatch(html, /id="product-db-file"|id="product-db-status"/);
  assert.doesNotMatch(html, /id="sync-cod-fee"|id="sync-shipping-fee"/);
  assert.match(html, /https:\/\/ph-ecommerce-profitability-calculator\.example\/og\.png/);
  assert.doesNotMatch(html, /__SITE_ORIGIN__|RTS CHECKER|FulfilRate|KitaKalkula|Item name|QUICK PROFIT CHECK|I-compute ang kita/);
  const inputOrder = ["cod", "cod-fee", "rts", "cog", "ad-spend", "order-qty", "shipping-fee"]
    .map((id) => html.indexOf(`id="${id}"`));
  assert.deepEqual(inputOrder, [...inputOrder].sort((a, b) => a - b));
  assert.match(css, /color-scheme:\s*dark/i);
  assert.match(css, /--paper:\s*#07100d/i);
  assert.match(app, /outputs\.netIncome\.textContent = money\(result\.netBeforeRts\)/);
  assert.match(app, /outputs\.netIncludingRts\.textContent = money\(result\.netIncome\)/);
});

test("calculator follows the corrected workbook formulas", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const sandbox = { window: {} };
  runInNewContext(source, sandbox);
  const { computeNetIncome, VAT_RATE } = sandbox.window.NetIncomeCalculator;

  const result = computeNetIncome({
    cod: 1000,
    codFeePercent: 3,
    rtsPercent: 20,
    cog: 200,
    adSpend: 10000,
    orderQty: 100,
    shippingFee: 40,
  });

  assert.equal(VAT_RATE, 0.12);
  assert.equal(result.deliveredOrders, 80);
  assert.equal(result.rtsOrders, 20);
  assert.equal(result.roas, 10);
  assert.equal(result.cpp, 100);
  assert.equal(result.grossReceivable, 80000);
  assert.equal(result.vat, 1200);
  assert.equal(result.totalCog, 20000);
  assert.equal(result.baseShippingFees, 4000);
  assert.equal(result.shippingFee, 40);
  assert.ok(Math.abs(result.codFee - 2688) < 1e-9);
  assert.ok(Math.abs(result.netBeforeRts - 42112) < 1e-9);
  assert.equal(result.rtsInventoryAddBack, 4000);
  assert.ok(Math.abs(result.netIncome - 46112) < 1e-9);
});

test("calculator handles boundaries without circular or invalid output", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const sandbox = { window: {} };
  runInNewContext(source, sandbox);
  const { computeNetIncome } = sandbox.window.NetIncomeCalculator;

  const result = computeNetIncome({
    cod: 500,
    codFeePercent: -2,
    rtsPercent: 150,
    cog: 100,
    adSpend: 0,
    orderQty: 10.9,
    shippingFee: -20,
  });

  assert.equal(result.orderQty, 10);
  assert.equal(result.codFeePercent, 0);
  assert.equal(result.rtsPercent, 100);
  assert.equal(result.deliveredOrders, 0);
  assert.equal(result.rtsOrders, 10);
  assert.equal(result.roas, null);
  assert.equal(result.cpp, 0);
  assert.equal(result.shippingFee, 0);
  assert.ok(Number.isFinite(result.netIncome));
  assert.doesNotMatch(source, /adSpend\s*\/\s*cpp|cpp\s*\/\s*cpp/i);
});

test("data sync uses fixed fees, matches the latest product record, and calculates Net Ratio per page", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const sandbox = { window: {} };
  runInNewContext(source, sandbox);
  const { DATA_SYNC_SETTINGS, parseProductRows, parseDailyRows, calculateDataSync } = sandbox.window.DataSyncCalculator;

  const products = parseProductRows([
    { "Effective Date": "2026-01-01", "Item Name": "Gold Utensils", "RTS Rate": "25%", COG: "₱180" },
    { "Effective Date": "2026-07-17", "Item Name": "GOLD UTENSILS", "RTS Rate": "20%", COG: "₱200" },
  ]);
  const daily = parseDailyRows([
    { "Page Name": "Luxe Kitchenware", "Item Name": "Gold Utensils", COD: "₱1,000", ADSPENT: "₱10,000", Orders: 100 },
  ]);
  const result = calculateDataSync(daily, products, DATA_SYNC_SETTINGS);

  assert.equal(products.length, 2);
  assert.equal(daily.length, 1);
  assert.equal(result.unmatchedItems.length, 0);
  assert.equal(result.matchedItems, 1);
  assert.equal(DATA_SYNC_SETTINGS.codFeePercent, 1);
  assert.equal(DATA_SYNC_SETTINGS.shippingFee, 37.5);
  assert.ok(Math.abs(result.netWithoutRts - 44154) < 1e-9);
  assert.ok(Math.abs(result.netWithRts - 48154) < 1e-9);
  assert.ok(Math.abs(result.netRatio - 4.4154) < 1e-9);
  assert.equal(result.pages[0].pageName, "Luxe Kitchenware");
  assert.ok(Math.abs(result.pages[0].netRatio - 4.4154) < 1e-9);
});

test("backend validates uploaded rows and computes without exposing product costs", () => {
  const daily = validateDailyRows([
    {
      date: "2026-07-18",
      pageName: "Luxe Kitchenware",
      itemName: "Gold Utensils",
      adAccount: "Alexandrite",
      cod: 1000,
      adSpend: 10000,
      orderQty: 100,
    },
  ]);
  const result = calculateBackendDataSync(daily, [
    {
      itemName: "GOLD UTENSILS",
      itemKey: normaliseBackendItemName("GOLD UTENSILS"),
      effectiveDate: "2026-07-18",
      rtsRate: 20,
      cog: 200,
    },
  ]);

  assert.equal(daily.length, 1);
  assert.equal(result.unmatchedItems.length, 0);
  assert.ok(Math.abs(result.netWithoutRts - 44154) < 1e-9);
  assert.ok(Math.abs(result.netWithRts - 48154) < 1e-9);
  assert.ok(Math.abs(result.netRatio - 4.4154) < 1e-9);
});

test("packages standalone and GitHub Pages quick calculators", async () => {
  const [offline, html, bundle] = await Promise.all([
    readFile(
      new URL("../outputs/PH-ECOMMERCE-PROFITABILITY-CALCULATOR-OFFLINE.html", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../outputs/github-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../outputs/github-pages/app.bundle.js", import.meta.url), "utf8"),
  ]);

  assert.match(offline, /<style>[\s\S]*\.calculator-shell/);
  assert.match(offline, /window\.NetIncomeCalculator/);
  assert.doesNotMatch(offline, /<script[^>]+src="\//i);
  assert.match(html, /<script src="\.\/app\.bundle\.js\?v=20260718-4" defer><\/script>/);
  assert.match(bundle, /computeNetIncome/);
  assert.match(bundle, /deliveredOrders/);
  assert.match(bundle, /rtsInventoryAddBack/);
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../outputs/github-pages/og.png", import.meta.url));
  await access(new URL("../outputs/github-pages/.nojekyll", import.meta.url));
  await access(new URL("../outputs/github-pages/vendor/xlsx.full.min.js", import.meta.url));
  await access(new URL("../outputs/github-pages/data/product-master.json", import.meta.url));
});
