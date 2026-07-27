import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
config({ path: path.join(repositoryRoot, ".env"), override: false, quiet: true });

const port = String(process.env.WWPDW_HOME_PORT ?? "43187");
const webDistDirectory = path.resolve(
  process.env.WWPDW_WEB_DIST_DIR ?? path.join(repositoryRoot, "apps", "web", "dist")
);
const localDataDirectory = path.resolve(
  process.env.WWPDW_HOME_DATA_DIR ?? path.join(repositoryRoot, ".local-data", "home-site")
);
const publicOrigin = process.env.WWPDW_HOME_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
const localOrigins = [
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  publicOrigin
].filter(Boolean);

if (!existsSync(path.join(webDistDirectory, "index.html"))) {
  throw new Error(`Home web build was not found at ${webDistDirectory}. Run "npm run home:build" first.`);
}

process.env.API_PORT = port;
process.env.WWPDW_WEB_DIST_DIR = webDistDirectory;
process.env.WWPDW_LOCAL_DATA_DIR = localDataDirectory;
process.env.CACHE_BACKEND = process.env.WWPDW_HOME_CACHE_BACKEND ?? "local";
process.env.WWPDW_ALLOWED_WEB_ORIGINS ??= localOrigins.join(",");
process.env.NODE_ENV = publicOrigin?.startsWith("https://") ? "production" : "development";

console.log(JSON.stringify({
  event: "home.start",
  localUrl: `http://127.0.0.1:${port}`,
  publicOrigin,
  webDistDirectory,
  localDataDirectory,
  cacheBackend: process.env.CACHE_BACKEND,
  nodeEnvironment: process.env.NODE_ENV
}));

await import("../apps/api/src/server.ts");
