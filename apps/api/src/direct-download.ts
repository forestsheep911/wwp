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
