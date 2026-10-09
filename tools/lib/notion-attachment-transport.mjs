import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

export function transportUrl(relative) {
  const root = process.env.NOTION_ATTACHMENT_TRANSFER_ROOT
    || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills", "notion-attachment-transfer");
  return pathToFileURL(path.join(root, "scripts", relative)).href;
}

export async function uploadProjectAttachment(input) {
  const { uploadProjectFile } = await import(transportUrl("lib/project-upload.mjs"));
  return uploadProjectFile(input);
}

// Retain fetched poster bytes locally and hand the durable file to shared transport.
export async function uploadPosterAttachment({ bytes, filename, contentType }) {
  const fs = await import("node:fs");
  const { createHash } = await import("node:crypto");

  if (path.basename(filename) !== filename) {
    throw new Error("Poster filename must be a basename.");
  }

  const data = Buffer.from(bytes);
  const hash = createHash("sha256").update(data).digest("hex");
  const root = path.resolve(".local-data", "notion-attachments", hash);
  fs.mkdirSync(root, { recursive: true });

  const filePath = path.join(root, filename);
  const manifestPath = path.join(root, "upload.json");
  if (fs.existsSync(filePath)) {
    const savedHash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    if (savedHash !== hash) throw new Error("Saved poster identity changed.");
  } else {
    fs.writeFileSync(filePath, data, { flag: "wx" });
  }

  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { uploads: {} };
  const id = await uploadProjectAttachment({
    file: { name: filename, path: filePath, size: data.length },
    options: { partMiB: 20 },
    manifest,
    manifestPath,
    contentType,
    token: process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN || process.env.NOTION_API_KEY,
  });
  return { id };
}
