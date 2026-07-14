import appCss from "../public/app.css?raw";
import appJs from "../public/app.js?raw";
import faviconSvg from "../public/favicon.svg?raw";
import indexHtml from "../public/index.html?raw";
import pageMappingJs from "../public/page-mapping.js?raw";
import productNormalizerJs from "../public/product-normalizer.js?raw";
import xlsxJs from "../public/vendor/xlsx.full.min.js?raw";

interface Env {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

type EmbeddedAsset = {
  body: string;
  contentType: string;
};

const embeddedAssets = new Map<string, EmbeddedAsset>([
  ["/index.html", { body: indexHtml, contentType: "text/html; charset=utf-8" }],
  ["/app.css", { body: appCss, contentType: "text/css; charset=utf-8" }],
  ["/app.js", { body: appJs, contentType: "text/javascript; charset=utf-8" }],
  [
    "/page-mapping.js",
    { body: pageMappingJs, contentType: "text/javascript; charset=utf-8" },
  ],
  [
    "/product-normalizer.js",
    { body: productNormalizerJs, contentType: "text/javascript; charset=utf-8" },
  ],
  [
    "/vendor/xlsx.full.min.js",
    { body: xlsxJs, contentType: "text/javascript; charset=utf-8" },
  ],
  ["/favicon.svg", { body: faviconSvg, contentType: "image/svg+xml" }],
]);

function embeddedResponse(pathname: string): Response | null {
  const asset = embeddedAssets.get(pathname);
  if (!asset) return null;

  return new Response(asset.body, {
    headers: {
      "Cache-Control":
        pathname === "/index.html" ? "no-cache" : "public, max-age=3600",
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", {
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
      });
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const embedded = embeddedResponse(pathname);
    if (embedded) return embedded;

    if (env.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("RTS CHECKER is temporarily unavailable. Please refresh.", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "10",
      },
    });
  },
};
