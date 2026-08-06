const defaultNotionPublicSiteUrl = "https://wwpdw.notion.site";

export function notionPublicPageUrl(
  sourcePageId: string | undefined,
  siteUrl = process.env.NOTION_PUBLIC_SITE_URL ?? defaultNotionPublicSiteUrl
) {
  const compactPageId = sourcePageId?.replace(/-/g, "");
  if (!compactPageId || !/^[0-9a-f]{32}$/i.test(compactPageId)) {
    return undefined;
  }

  try {
    const baseUrl = new URL(siteUrl);
    if (baseUrl.protocol !== "https:") {
      return undefined;
    }
    baseUrl.pathname = `/${compactPageId}`;
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.toString();
  } catch {
    return undefined;
  }
}

export function isDirectMediaDownloadUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname === "file.notion.so") {
      return true;
    }

    const isNotionPageHost = hostname === "notion.so" ||
      hostname.endsWith(".notion.so") ||
      hostname === "notion.site" ||
      hostname.endsWith(".notion.site");
    if (isNotionPageHost) {
      return url.pathname.startsWith("/signed/");
    }

    return true;
  } catch {
    return false;
  }
}
