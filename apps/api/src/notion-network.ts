import dns from "node:dns";

let installed = false;

export function installNotionDnsOverride(address = process.env.NOTION_API_RESOLVE_IP?.trim()) {
  if (!address || installed) return false;
  const originalLookup = dns.lookup.bind(dns) as (...args: unknown[]) => unknown;
  dns.lookup = ((hostname: string, options: unknown, callback?: unknown) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") {
        options(null, address, 4);
        return;
      }
      if (typeof callback === "function") {
        if (options && typeof options === "object" && "all" in options && options.all) {
          callback(null, [{ address, family: 4 }]);
          return;
        }
        callback(null, address, 4);
        return;
      }
    }
    return originalLookup(hostname, options, callback);
  }) as typeof dns.lookup;
  installed = true;
  return true;
}

export function notionProxyUrl() {
  if (process.env.NOTION_API_RESOLVE_IP?.trim()) return undefined;
  return process.env.NOTION_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
}
