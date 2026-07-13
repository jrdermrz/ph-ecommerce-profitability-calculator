import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const indexHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname !== "/index.html") return new Response("Not found", { status: 404 });
          return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        },
      },
    },
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
  const [html, appScript, worker, css, packageJson] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/app.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(html, /Delivered rate × In Transit/);
  assert.match(html, /RTS rate × In Transit/);
  assert.match(html, /DELIVERED RATE/);
  assert.match(html, /RTS RATE/);
  assert.match(html, /DELIVERY FORECAST/);
  assert.match(html, /RTS FORECAST/);
  assert.match(appScript, /buy\\s\*\\d\+/i);
  assert.match(appScript, /\\d\+\\s\*\[x×\]/i);
  assert.match(css, /--red:\s*#d93838/i);
  assert.match(css, /\.rts-column/);
  assert.match(html, /\/vendor\/xlsx\.full\.min\.js/);
  assert.doesNotMatch(packageJson, /"xlsx"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(worker, /vinext|node:/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../public/vendor/xlsx.full.min.js", import.meta.url));
  await access(new URL("../pnpm-lock.yaml", import.meta.url));
});
