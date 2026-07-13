import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

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

test("server-renders the RTS CHECKER upload experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RTS CHECKER — Delivered &amp; RTS Rates<\/title>/i);
  assert.match(html, /FAST RTS CHECKER/);
  assert.match(html, /DETERMINE YOUR/);
  assert.match(html, /DELIVERED AND RTS RATES/);
  assert.doesNotMatch(html, /hero-copy|FulfilRate/i);
  assert.match(html, /UPLOAD FILE/);
  assert.match(html, /GENERATE/);
  assert.match(html, /Order Status/);
  assert.match(html, /Sender Name/);
  assert.match(html, /Item Name/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps the requested formulas and red RTS columns in the product source", async () => {
  const [html, appScript, worker, css, packageJson, pageMapping, normalizerScript] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/app.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/page-mapping.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product-normalizer.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /Delivered rate × In Transit/);
  assert.match(html, /RTS rate × In Transit/);
  assert.match(html, /DELIVERED RATE/);
  assert.match(html, /PAGE NAME/);
  assert.match(html, /RTS RATE/);
  assert.match(html, /DELIVERY FORECAST/);
  assert.match(html, /RTS FORECAST/);
  assert.match(normalizerScript, /buy\\s\*\\d\+/i);
  assert.match(normalizerScript, /variantLabel/);
  assert.match(normalizerScript, /stripRepeatedQuantitySuffix/);
  assert.match(appScript, /normaliseKey\(sender\).*normaliseKey\(product\)/s);
  assert.match(appScript, /pageNameFor\(sender\)/);
  assert.match(pageMapping, /"TAURUS SZ": "SOLAR NAME"/);
  assert.match(css, /--red:\s*#ff5d63/i);
  assert.match(css, /color-scheme:\s*dark/i);
  assert.match(css, /\.rts-column/);
  assert.match(html, /\/vendor\/xlsx\.full\.min\.js/);
  assert.match(html, /\/page-mapping\.js/);
  assert.match(html, /\/product-normalizer\.js/);
  assert.doesNotMatch(packageJson, /"xlsx"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(worker, /vinext|node:/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../public/vendor/xlsx.full.min.js", import.meta.url));
  await access(new URL("../public/page-mapping.js", import.meta.url));
  await access(new URL("../public/product-normalizer.js", import.meta.url));
  await access(new URL("../pnpm-lock.yaml", import.meta.url));
});

test("merges variants and quantity offers without merging different products", async () => {
  const source = await readFile(new URL("../public/product-normalizer.js", import.meta.url), "utf8");
  const sandbox = { window: {} };
  runInNewContext(source, sandbox);
  const { normaliseProductName } = sandbox.window.RTSProductNormalizer;

  assert.equal(normaliseProductName("FOLDABLE TUMBLER"), "FOLDABLE TUMBLER");
  assert.equal(normaliseProductName("FOLDABLE TUMBLER: color: black"), "FOLDABLE TUMBLER");
  assert.equal(
    normaliseProductName("FOLDABLE TUMBLER: color: Black, size: Large"),
    "FOLDABLE TUMBLER",
  );
  assert.equal(
    normaliseProductName("BATH SCRUBBER - 1X BATH SCRUBBER 1X BATH SCRUBBER"),
    "BATH SCRUBBER",
  );
  assert.equal(
    normaliseProductName("FOLDABLE STORAGE-1X FOLDABLE STORAGE-BOXBOX"),
    "FOLDABLE STORAGE",
  );
  assert.equal(normaliseProductName("MULTI PURPOSE RACK - BLACK"), "MULTI PURPOSE RACK");
  assert.equal(normaliseProductName("1X BATH SCRUBBER"), "BATH SCRUBBER");
  assert.equal(normaliseProductName("BATH SCRUBBER"), "BATH SCRUBBER");
  assert.equal(normaliseProductName("HAIR DRYER"), "HAIR DRYER");
  assert.notEqual(normaliseProductName("BATH SCRUBBER"), normaliseProductName("HAIR DRYER"));
});
