import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  calculateDataSync as calculateBackendDataSync,
  normaliseItemName as normaliseBackendItemName,
  parseProductMasterCsv,
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
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /No data shall be saved/);
  assert.match(html, /Base shipping fee used/);
  assert.match(html, /<th>Net with RTS<\/th>/);
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
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /\.data-sync-panel\s*\{[^}]*width:\s*calc\(100% - 24px\)/s);
  assert.match(css, /\.sync-workspace\s*\{[^}]*width:\s*min\(100%, 1240px\)/s);
  assert.match(css, /\.page-net-table-wrap\s*\{\s*overflow:\s*visible/);
  assert.match(css, /\.page-net-table\s*\{[^}]*table-layout:\s*fixed/s);
  assert.match(css, /\.page-net-table td\s*\{[^}]*font-size:\s*clamp\(11px, 0\.72vw, 14px\)/s);
  assert.match(css, /\.page-net-table th\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s);
  assert.match(app, /outputs\.netIncome\.textContent = money\(result\.netBeforeRts\)/);
  assert.match(app, /outputs\.netIncludingRts\.textContent = money\(result\.netIncome\)/);
  assert.match(app, /loadLiveProductRecords/);
  assert.match(app, /localFallback:\s*true/);
  assert.match(app, /No data was saved\./);
});

test("Google Sheet table responses are converted into product rows for the browser fallback", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const sandbox = { window: {} };
  runInNewContext(source, sandbox);
  const { googleTableRows, parseProductRows } = sandbox.window.DataSyncCalculator;

  const rows = googleTableRows({
    cols: [
      { id: "A", label: "Effective Date" },
      { id: "B", label: "Item Name" },
      { id: "C", label: "RTS Rate" },
      { id: "D", label: "COG" },
    ],
    rows: [
      { c: [{ v: "2026-07-20" }, { v: "Gold Utensils" }, { v: 25 }, { v: 72 }] },
    ],
  });
  const products = parseProductRows(rows);

  assert.equal(products.length, 1);
  assert.equal(products[0].itemName, "Gold Utensils");
  assert.equal(products[0].rtsRate, 25);
  assert.equal(products[0].cog, 72);
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
  assert.equal(DATA_SYNC_SETTINGS.shippingFee, 41);
  assert.ok(Math.abs(result.netWithoutRts - 43804) < 1e-9);
  assert.ok(Math.abs(result.netWithRts - 47804) < 1e-9);
  assert.ok(Math.abs(result.netRatio - 4.3804) < 1e-9);
  assert.equal(result.pages[0].pageName, "Luxe Kitchenware");
  assert.ok(Math.abs(result.pages[0].netRatio - 4.3804) < 1e-9);
});

test("backend validates uploaded rows and returns the spreadsheet breakdown", () => {
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
  assert.ok(Math.abs(result.netWithoutRts - 43804) < 1e-9);
  assert.ok(Math.abs(result.netWithRts - 47804) < 1e-9);
  assert.ok(Math.abs(result.netRatio - 4.3804) < 1e-9);
  assert.equal(result.pages[0].cog, 200);
  assert.equal(result.pages[0].rtsRate, 20);
  assert.equal(result.pages[0].baseShippingFees, 4100);
});

test("Data Sync matches the supplied Luxe Kitchenware reference row", () => {
  const daily = validateDailyRows([{
    pageName: "LUXE KITCHENWARE",
    itemName: "GOLD UTENSILS (24 PCS)",
    cod: 299,
    adSpend: 12351.42,
    orderQty: 126,
  }]);
  const result = calculateBackendDataSync(daily, [{
    itemName: "GOLD UTENSILS (24 PCS)",
    itemKey: normaliseBackendItemName("GOLD UTENSILS (24 PCS)"),
    effectiveDate: "2026-07-19",
    rtsRate: 25,
    cog: 72,
  }]);
  const page = result.pages[0];

  assert.equal(page.orders, 126);
  assert.equal(page.grossReceivable, 28106);
  assert.ok(Math.abs(page.vat - 1482.1704) < 1e-9);
  assert.equal(page.totalCog, 9072);
  assert.equal(page.baseShippingFees, 5166);
  assert.ok(Math.abs(page.codFee - 314.7872) < 1e-9);
  assert.ok(Math.abs(page.netWithoutRts - (-280.3776)) < 1e-9);
  assert.equal(page.rtsInventoryCog, 2304);
  assert.ok(Math.abs(page.netWithRts - 2023.6224) < 1e-9);
});

test("Google Sheet CSV uses the latest valid RTS and COG record per item", () => {
  const products = parseProductMasterCsv([
    '"Effective Date","Item Name","RTS Rate","COG","Updated At","Notes"',
    '"2026-06-01","GOLD UTENSILS (24 PCS)","25%","72","","old"',
    '"2026-07-01","GOLD UTENSILS (24 PCS)","20","80","","latest"',
    '"","STICKY GLUE MICE TRAP","0.42","10.5","",""',
  ].join("\n"));

  assert.equal(products.length, 2);
  assert.deepEqual(
    { rtsRate: products[0].rtsRate, cog: products[0].cog, effectiveDate: products[0].effectiveDate },
    { rtsRate: 20, cog: 80, effectiveDate: "2026-07-01" },
  );
  assert.equal(products[1].rtsRate, 42);
  assert.equal(products[1].cog, 10.5);
});

test("Data Sync applies red, green, and break-even result tones", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const sandbox = { window: {} };
  runInNewContext(source, sandbox);
  const { profitabilityTone } = sandbox.window.DataSyncCalculator;

  assert.equal(profitabilityTone(-0.01, -0.001), "negative");
  assert.equal(profitabilityTone(0, 0), "break-even");
  assert.equal(profitabilityTone(50, 0.05), "break-even");
  assert.equal(profitabilityTone(50.01, 0.05001), "positive");
});

test("data sync preserves upload order and derives totals from the page breakdown", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const sandbox = { window: {} };
  runInNewContext(source, sandbox);
  const { DATA_SYNC_SETTINGS, parseProductRows, parseDailyRows, calculateDataSync } = sandbox.window.DataSyncCalculator;
  const rawProducts = [
    { "Item Name": "First Product", "RTS Rate": "40%", COG: 180 },
    { "Item Name": "Second Product", "RTS Rate": "5%", COG: 50 },
    { "Item Name": "Third Product", "RTS Rate": "20%", COG: 100 },
  ];
  const rawDaily = [
    { "Page Name": "First Uploaded Page", "Item Name": "First Product", COD: 179, ADSPENT: 5000, Orders: 20 },
    { "Page Name": "Second Uploaded Page", "Item Name": "Second Product", COD: 299, ADSPENT: 500, Orders: 50 },
    { "Page Name": "First Uploaded Page", "Item Name": "Third Product", COD: 199, ADSPENT: 300, Orders: 10 },
  ];
  const frontendResult = calculateDataSync(parseDailyRows(rawDaily), parseProductRows(rawProducts), DATA_SYNC_SETTINGS);
  const backendResult = calculateBackendDataSync(validateDailyRows(rawDaily.map((row) => ({
    pageName: row["Page Name"],
    itemName: row["Item Name"],
    cod: row.COD,
    adSpend: row.ADSPENT,
    orderQty: row.Orders,
  }))), rawProducts.map((row) => ({
    itemName: row["Item Name"],
    itemKey: normaliseBackendItemName(row["Item Name"]),
    effectiveDate: "2026-07-19",
    rtsRate: Number.parseFloat(row["RTS Rate"]),
    cog: row.COG,
  })));

  for (const result of [frontendResult, backendResult]) {
    assert.deepEqual(Array.from(result.pages, (page) => page.pageName), ["First Uploaded Page", "Second Uploaded Page"]);
    assert.ok(Math.abs(result.netWithoutRts - result.pages.reduce((sum, page) => sum + page.netWithoutRts, 0)) < 1e-9);
    assert.ok(Math.abs(result.netWithRts - result.pages.reduce((sum, page) => sum + page.netWithRts, 0)) < 1e-9);
    assert.equal(result.orders, result.pages.reduce((sum, page) => sum + page.orders, 0));
    assert.equal(result.adSpend, result.pages.reduce((sum, page) => sum + page.adSpend, 0));
  }
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
  assert.match(html, /<script src="\.\/app\.bundle\.js\?v=20260720-1" defer><\/script>/);
  assert.match(bundle, /computeNetIncome/);
  assert.match(bundle, /deliveredOrders/);
  assert.match(bundle, /rtsInventoryAddBack/);
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../outputs/github-pages/og.png", import.meta.url));
  await access(new URL("../outputs/github-pages/.nojekyll", import.meta.url));
  await access(new URL("../outputs/github-pages/vendor/xlsx.full.min.js", import.meta.url));
  await access(new URL("../outputs/github-pages/data/product-master.json", import.meta.url));
});
