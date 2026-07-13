import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the FulfilRate upload experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>FulfilRate — Delivery &amp; RTS Forecasts<\/title>/i);
  assert.match(html, /UPLOAD FILE/);
  assert.match(html, /GENERATE/);
  assert.match(html, /Order Status/);
  assert.match(html, /Sender Name/);
  assert.match(html, /Item Name/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps the requested formulas and red RTS columns in the product source", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Delivered rate × In Transit/);
  assert.match(page, /RTS rate × In Transit/);
  assert.match(page, /DELIVERED RATE/);
  assert.match(page, /RTS RATE/);
  assert.match(page, /DELIVERY FORECAST/);
  assert.match(page, /RTS FORECAST/);
  assert.match(page, /buy\\s\*\\d\+/i);
  assert.match(page, /\\d\+\\s\*\[x×\]/i);
  assert.match(css, /--red:\s*#d93838/i);
  assert.match(css, /\.rts-column/);
  assert.match(packageJson, /"xlsx"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(layout, /next\/headers|generateMetadata/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../pnpm-lock.yaml", import.meta.url));
});
