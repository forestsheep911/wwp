import { createHash } from "node:crypto";

export function maintainedPosterFiles(page) {
  const urls = Object.entries(page.properties ?? {})
    .filter(([name, value]) => /^(海报|posters?)$/i.test(name) && value.type === "files")
    .flatMap(([, value]) => (value.files ?? []).map(file => file.file?.url ?? file.external?.url))
    .filter(Boolean);
  return [...new Set(urls)];
}

export function decodeIndexEntity(entity) {
  let payload = entity.payload;
  for (let i = 1; i < (entity.payloadChunks ?? 1); i++) {
    const chunk = entity[`payload${String(i).padStart(2, "0")}`];
    if (typeof chunk !== "string") throw new Error("Index payload chunk missing");
    payload += chunk;
  }
  return JSON.parse(payload);
}

export function posterOnlyIndexPatch(entity, posters, now = new Date().toISOString()) {
  const entry = decodeIndexEntity(entity);
  if (!entry.result.metadata) throw new Error("Cannot patch an entry without metadata");
  const metadata = entry.result.metadata;
  metadata.posters = posters;
  metadata.posterUrl = posters[0]?.url;
  if (metadata.work) metadata.work.media = { ...metadata.work.media, posters };
  entry.indexedAt = now;
  const json = JSON.stringify(entry);
  const chunks = json.match(/[\s\S]{1,30000}/g) ?? [""];
  return {
    partitionKey: entity.partitionKey, rowKey: entity.rowKey, indexedAt: now,
    payload: chunks[0], payloadChunks: chunks.length,
    ...Object.fromEntries(chunks.slice(1).map((chunk, i) => [`payload${String(i + 1).padStart(2, "0")}`, chunk]))
  };
}

export function ownedPosterFile(assetKey, index, buffer) {
  let extension, contentType;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) [extension, contentType] = ["jpg", "image/jpeg"];
  else if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) [extension, contentType] = ["png", "image/png"];
  else if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") [extension, contentType] = ["webp", "image/webp"];
  else if (/^GIF8[79]a$/.test(buffer.toString("ascii", 0, 6))) [extension, contentType] = ["gif", "image/gif"];
  else throw new Error("Unsupported or invalid image bytes");
  const hash = createHash("sha256").update(buffer).digest("hex");
  return { blobName: `posters/${Buffer.from(assetKey).toString("base64url")}/${String(index + 1).padStart(2,"0")}-${hash.slice(0,20)}.${extension}`, contentType, hash };
}
