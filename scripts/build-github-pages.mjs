import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(projectRoot, "public");
const outputRoot = resolve(projectRoot, "outputs", "github-pages");
const readPublic = (path) => readFile(resolve(publicRoot, path), "utf8");

let html = await readPublic("index.html");
const [css, app] = await Promise.all([readPublic("app.css"), readPublic("app.js")]);

html = html
  .replaceAll("__SITE_ORIGIN__", ".")
  .replace('<link rel="stylesheet" href="./app.css" />', `<style>${css}</style>`)
  .replace(
    /\s*<script src="\.\/app\.js" defer><\/script>/,
    '\n    <script src="./app.bundle.js" defer></script>',
  );

await mkdir(outputRoot, { recursive: true });
await Promise.all([
  writeFile(resolve(outputRoot, "index.html"), html, "utf8"),
  writeFile(resolve(outputRoot, "app.bundle.js"), app, "utf8"),
  writeFile(resolve(outputRoot, ".nojekyll"), "", "utf8"),
  copyFile(resolve(publicRoot, "og.png"), resolve(outputRoot, "og.png")),
]);
console.log(outputRoot);
