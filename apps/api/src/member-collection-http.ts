import type http from "node:http";
import { CollectionConflict } from "@wwpdw/cache-store";
import type { ImportStrategy } from "@wwpdw/shared";
import type { MemberCollectionService } from "./member-collection.js";

async function readInput(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 22 * 1024 * 1024) throw new Error("文件不能超过 20 MB。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
export async function handleMemberCollection(
  request: http.IncomingMessage, response: http.ServerResponse, pathname: string,
  identity: { role: string; memberId?: string }, service: MemberCollectionService
) {
  const send = (status: number, value: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" });
    response.end(JSON.stringify(value));
  };
  const owner = identity.role === "member" && identity.memberId ? `member:${identity.memberId}` : identity.role === "admin" ? "admin" : undefined;
  if (!owner) { send(403, { error: "请登录会员账号后使用个人片单。" }); return; }
  try {
    if (request.method === "GET" && pathname === "/api/member/collection") { send(200, await service.get(owner)); return; }
    if (request.method !== "POST") { send(405, { error: "不支持的操作。" }); return; }
    const body = await readInput(request);
    if (pathname === "/api/member/collection/preview") {
      send(200, await service.preview(owner, body.data, body.strategy as ImportStrategy)); return;
    }
    if (pathname === "/api/member/collection/commit" && typeof body.id === "string") {
      send(200, await service.commit(owner, body.id, body.confirmReplace === true)); return;
    }
    if (pathname === "/api/member/collection/undo" && typeof body.id === "string" && typeof body.revision === "string") {
      send(200, await service.undo(owner, body.id, body.revision)); return;
    }
    if (pathname === "/api/member/collection/mark" && typeof body.assetKey === "string" && typeof body.mark === "string" && typeof body.active === "boolean" && typeof body.revision === "string") {
      send(200, await service.mark(owner, body.assetKey, body.mark, body.active, body.revision)); return;
    }
    send(400, { error: "请求参数无效。" });
  } catch (error) {
    if (error instanceof CollectionConflict) { send(409, { error: error.message }); return; }
    if (error instanceof SyntaxError) { send(400, { error: "JSON 文件格式无效。" }); return; }
    // Expected validation errors are authored in Chinese; do not expose storage details.
    if (error instanceof Error && /^[\u3400-\u9fff]/.test(error.message)) { send(400, { error: error.message }); return; }
    send(503, { error: "个人片单服务暂时不可用，请稍后重试。" });
  }
}
