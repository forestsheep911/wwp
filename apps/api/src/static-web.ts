import { readFile, stat } from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import {
  brotliCompress,
  constants as zlibConstants,
  gzip
} from "node:zlib";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

export interface StaticWebFile {
  absolutePath: string;
  cacheControl: string;
  contentType: string;
  size: number;
}

type StaticContentEncoding = "br" | "gzip";

function encodingQuality(header: string, encoding: StaticContentEncoding) {
  let wildcardQuality: number | undefined;
  for (const entry of header.toLowerCase().split(",")) {
    const [name, ...parameters] = entry.trim().split(";").map((part) => part.trim());
    const qualityParameter = parameters.find((parameter) => parameter.startsWith("q="));
    const quality = qualityParameter
      ? Number(qualityParameter.slice(2))
      : 1;
    const normalizedQuality = Number.isFinite(quality)
      ? Math.max(0, Math.min(1, quality))
      : 0;
    if (name === encoding) return normalizedQuality;
    if (name === "*") wildcardQuality = normalizedQuality;
  }
  return wildcardQuality ?? 0;
}

function compressibleContentType(contentType: string) {
  return contentType.startsWith("text/")
    || contentType.startsWith("application/javascript")
    || contentType.startsWith("application/json")
    || contentType.startsWith("image/svg+xml");
}

export function preferredStaticContentEncoding(
  acceptEncoding: string | undefined,
  contentType: string,
  size: number
): StaticContentEncoding | undefined {
  if (!acceptEncoding || size < 1_024 || !compressibleContentType(contentType)) {
    return undefined;
  }
  const brotliQuality = encodingQuality(acceptEncoding, "br");
  const gzipQuality = encodingQuality(acceptEncoding, "gzip");
  if (brotliQuality <= 0 && gzipQuality <= 0) return undefined;
  return brotliQuality >= gzipQuality ? "br" : "gzip";
}

function safeRelativePath(pathname: string) {
  try {
    const decoded = decodeURIComponent(pathname).replaceAll("\\", "/");
    const relative = decoded.replace(/^\/+/, "");
    if (relative.split("/").some((segment) => segment === ".." || segment.startsWith("."))) {
      return undefined;
    }
    return relative;
  } catch {
    return undefined;
  }
}

async function fileMetadata(root: string, relativePath: string): Promise<StaticWebFile | undefined> {
  const absolutePath = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return undefined;
  }

  try {
    const metadata = await stat(absolutePath);
    if (!metadata.isFile()) {
      return undefined;
    }
    const extension = path.extname(absolutePath).toLowerCase();
    return {
      absolutePath,
      cacheControl: relativePath === "index.html"
        ? "no-cache"
        : relativePath.replaceAll("\\", "/").startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      contentType: contentTypes[extension] ?? "application/octet-stream",
      size: metadata.size
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function resolveStaticWebFile(
  rootDirectory: string,
  pathname: string
): Promise<StaticWebFile | undefined> {
  const root = path.resolve(rootDirectory);
  const relativePath = safeRelativePath(pathname);
  if (relativePath === undefined) {
    return undefined;
  }

  if (!relativePath) {
    return fileMetadata(root, "index.html");
  }

  const exact = await fileMetadata(root, relativePath);
  if (exact) {
    return exact;
  }

  // Browser routes belong to the React application. Missing requests that look
  // like real files stay missing instead of receiving HTML.
  return path.extname(relativePath) ? undefined : fileMetadata(root, "index.html");
}

export async function serveStaticWeb(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  pathname: string,
  rootDirectory = process.env.WWPDW_WEB_DIST_DIR
) {
  if (!rootDirectory || !["GET", "HEAD"].includes(request.method ?? "")) {
    return false;
  }

  const file = await resolveStaticWebFile(rootDirectory, pathname);
  if (!file) {
    return false;
  }

  const rawBody = await readFile(file.absolutePath);
  const contentEncoding = preferredStaticContentEncoding(
    request.headers["accept-encoding"],
    file.contentType,
    file.size
  );
  const body = contentEncoding === "br"
    ? await compressBrotli(rawBody, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 5
        }
      })
    : contentEncoding === "gzip"
      ? await compressGzip(rawBody, { level: 6 })
      : rawBody;

  response.writeHead(200, {
    "Cache-Control": file.cacheControl,
    ...(contentEncoding ? { "Content-Encoding": contentEncoding } : {}),
    "Content-Length": String(body.length),
    "Content-Type": file.contentType,
    "Referrer-Policy": "same-origin",
    "Vary": "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  if (request.method === "HEAD") {
    response.end();
  } else {
    response.end(body);
  }
  return true;
}
