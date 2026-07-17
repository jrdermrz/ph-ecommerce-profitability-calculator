import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(projectRoot, "public");
const outputPath = resolve(
  projectRoot,
  "outputs",
  "PH-ECOMMERCE-PROFITABILITY-CALCULATOR-OFFLINE.html",
);
const readPublic = (path) => readFile(resolve(publicRoot, path), "utf8");
const safeInlineScript = (source) => source.replaceAll(/<\/script/gi, "<\\/script");

let html = await readPublic("index.html");
const [css, app, xlsx, productMaster] = await Promise.all([
  readPublic("app.css"),
  readPublic("app.js"),
  readPublic("vendor/xlsx.full.min.js"),
  readPublic("data/product-master.json"),
]);

html = html
  .replaceAll("__SITE_ORIGIN__", ".")
  .replace('<link rel="stylesheet" href="./app.css" />', `<style>${css}</style>`)
  .replace(
    /\s*<script src="\.\/vendor\/xlsx\.full\.min\.js" defer><\/script>/,
    `<script>${safeInlineScript(xlsx)}</script>\n<script>window.__PRODUCT_MASTER__=${productMaster};</script>`,
  )
  .replace(/\s*<script src="\.\/app\.js" defer><\/script>/, "")
  .replace("</body>", `<script>${safeInlineScript(app)}</script>\n</body>`);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html, "utf8");
console.log(outputPath);
