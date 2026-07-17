import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(new Request("https://profit-actually.example/"), {
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
  assert.match(html, /<title>Profit, Actually\./i);
  assert.match(html, /Quick Calculator/);
  assert.match(html, /Upload Your Data/);
  assert.match(html, /ARE YOU SURE YOU'RE/);
  assert.match(html, /PROFITABLE\?/);
  assert.match(html, /Your quick local e-commerce profitability calculator\./);
  assert.match(html, /COD price/);
  assert.match(html, /Order quantity/);
  assert.match(html, /COG per item/);
  assert.match(html, /Ad spend/);
  assert.match(html, /COD fee/);
  assert.match(html, /RTS rate/);
  assert.match(html, /12%/);
  assert.match(html, /https:\/\/profit-actually\.example\/og\.png/);
  assert.doesNotMatch(html, /__SITE_ORIGIN__|RTS CHECKER|FulfilRate|KitaKalkula|Item name|QUICK PROFIT CHECK|I-compute ang kita/);
  const inputOrder = ["cod", "cod-fee", "rts", "cog", "ad-spend", "order-qty"]
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
  const { computeNetIncome, BASE_SHIPPING_FEE, VAT_RATE } = sandbox.window.NetIncomeCalculator;

  const result = computeNetIncome({
    cod: 1000,
    codFeePercent: 3,
    rtsPercent: 20,
    cog: 200,
    adSpend: 10000,
    orderQty: 100,
  });

  assert.equal(BASE_SHIPPING_FEE, 40);
  assert.equal(VAT_RATE, 0.12);
  assert.equal(result.deliveredOrders, 80);
  assert.equal(result.rtsOrders, 20);
  assert.equal(result.roas, 10);
  assert.equal(result.cpp, 100);
  assert.equal(result.grossReceivable, 80000);
  assert.equal(result.vat, 1200);
  assert.equal(result.totalCog, 20000);
  assert.equal(result.baseShippingFees, 4000);
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
  });

  assert.equal(result.orderQty, 10);
  assert.equal(result.codFeePercent, 0);
  assert.equal(result.rtsPercent, 100);
  assert.equal(result.deliveredOrders, 0);
  assert.equal(result.rtsOrders, 10);
  assert.equal(result.roas, null);
  assert.equal(result.cpp, 0);
  assert.ok(Number.isFinite(result.netIncome));
  assert.doesNotMatch(source, /adSpend\s*\/\s*cpp|cpp\s*\/\s*cpp/i);
});

test("packages standalone and GitHub Pages quick calculators", async () => {
  const [offline, html, bundle] = await Promise.all([
    readFile(new URL("../outputs/PROFIT-ACTUALLY-OFFLINE.html", import.meta.url), "utf8"),
    readFile(new URL("../outputs/github-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../outputs/github-pages/app.bundle.js", import.meta.url), "utf8"),
  ]);

  assert.match(offline, /<style>[\s\S]*\.calculator-shell/);
  assert.match(offline, /window\.NetIncomeCalculator/);
  assert.doesNotMatch(offline, /<script[^>]+src="\//i);
  assert.match(html, /<script src="\.\/app\.bundle\.js" defer><\/script>/);
  assert.match(bundle, /computeNetIncome/);
  assert.match(bundle, /deliveredOrders/);
  assert.match(bundle, /rtsInventoryAddBack/);
  await access(new URL("../public/og.png", import.meta.url));
});
