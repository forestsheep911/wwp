import { transportUrl } from "./notion-attachment-transport.mjs";
export const { supportedNotionUploadRoutes, evaluateNotionUploadRoute, requireNotionUploadRoute } = await import(transportUrl("lib/notion-upload-route-policy.mjs"));
