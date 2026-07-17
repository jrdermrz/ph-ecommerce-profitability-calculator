import appCss from "../public/app.css?raw";
import appJs from "../public/app.js?raw";
import indexHtml from "../public/index.html?raw";

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
