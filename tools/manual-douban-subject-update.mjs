import fs from "node:fs";
import { Client } from "@notionhq/client";

function dotenv(name) {
  const raw = fs.readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match?.[1] === name) {
      return match[2].trim();
    }
  }
  return process.env[name];
}

function cookieHeader() {
  const raw = fs.readFileSync(".douban.cookie", "utf8").trim();
  try {
    return JSON.parse(raw)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  } catch {
    return raw;
  }
}

function richText(content, href) {
  return [{ type: "text", text: { content, ...(href ? { link: { url: href } } : {}) } }];
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInfoPairs(infoText) {
  const labels = ["导演", "编剧", "主演", "类型", "制片国家/地区", "语言", "上映日期", "首播", "片长", "又名", "IMDb"];
  const pairs = {};
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const next = labels[index + 1];
    const pattern = next
      ? new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)\\s+${next}\\s*:`, "i")
      : new RegExp(`${label}\\s*:\\s*([\\s\\S]*)$`, "i");
    const match = infoText.match(pattern);
    if (match) {
      pairs[label] = match[1].trim();
    }
  }
  return pairs;
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...headers
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  return text;
}

async function fetchImage(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://movie.douban.com/"
    }
  });
  if (!response.ok) {
    throw new Error(`image HTTP ${response.status}`);
  }
  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "image/jpeg"
  };
}

async function updateOne(notion, cookie, item) {
  const html = await fetchText(`https://movie.douban.com/subject/${item.subjectId}/`, {
    Cookie: cookie,
    Referer: "https://movie.douban.com/"
  });
  const raw = html
    .match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
    ?.replace(/\n/g, "")
    .replace(/\t/g, "")
    .trim();
  const ld = JSON.parse(raw);
  const infoText = stripHtml(html.match(/<div id="info">([\s\S]*?)<\/div>/)?.[1] ?? "");
  const info = parseInfoPairs(infoText);
  const summary = stripHtml(html.match(/<span property="v:summary"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
  const imdb = info.IMDb?.match(/tt\d+/i)?.[0];
  const rating = Number(ld.aggregateRating?.ratingValue);
  const release =
    ld.datePublished ||
    info["上映日期"]?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ||
    info["首播"]?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const genres = Array.isArray(ld.genre) ? ld.genre : [];
  const genreOptions = new Set([
    "剧情",
    "冒险",
    "动作",
    "犯罪",
    "惊悚",
    "喜剧",
    "科幻",
    "动画",
    "浪漫",
    "悬疑",
    "奇幻",
    "家庭",
    "战争",
    "传记",
    "历史",
    "恐怖",
    "记录",
    "音乐",
    "运动",
    "西部",
    "短片",
    "歌舞",
    "黑色",
    "灾难",
    "真人秀"
  ]);
  const basicInfo = [
    ["导演", info["导演"]],
    ["编剧", info["编剧"]],
    ["主演", info["主演"]],
    ["类型", info["类型"] || genres.join(" / ")],
    ["制片国家/地区", info["制片国家/地区"]],
    ["语言", info["语言"]],
    ["上映日期", info["上映日期"] || release],
    ["首播", info["首播"]],
    ["片长", info["片长"]],
    ["又名", info["又名"]],
    ["IMDb", imdb]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");

  const image = await fetchImage(ld.image);
  const title = item.title || ld.name.split(/\s{2,}/)[0] || ld.name;
  const filename = `${title} poster - Douban.jpg`.replace(/[\\/:*?"<>|]/g, "_");
  const upload = await notion.fileUploads.create({
    mode: "single_part",
    filename,
    content_type: image.contentType
  });
  const sent = await notion.fileUploads.send({
    file_upload_id: upload.id,
    file: {
      filename,
      data: new Blob([image.bytes], { type: image.contentType })
    }
  });

  const properties = {
    Title: { title: richText(title) },
    "豆瓣评分": Number.isFinite(rating) ? { number: rating } : undefined,
    "上映日期": release ? { date: { start: release } } : undefined,
    "旨趣": genres.length
      ? { multi_select: genres.filter((genre) => genreOptions.has(genre)).map((name) => ({ name })) }
      : undefined,
    imdb: imdb ? { rich_text: richText(imdb, `https://www.imdb.com/title/${imdb}/`) } : undefined,
    "简介": ld.description || summary ? { rich_text: richText((ld.description || summary).slice(0, 1900)) } : undefined,
    "基本信息": basicInfo ? { rich_text: richText(basicInfo.slice(0, 1900)) } : undefined,
    "海报": { files: [{ name: filename, type: "file_upload", file_upload: { id: sent.id } }] }
  };
  for (const [key, value] of Object.entries(properties)) {
    if (!value || (value.multi_select && value.multi_select.length === 0)) {
      delete properties[key];
    }
  }

  const updated = await notion.pages.update({ page_id: item.pageId, properties });
  return {
    pageId: item.pageId,
    title,
    subjectId: item.subjectId,
    doubanTitle: ld.name,
    fields: Object.keys(properties),
    lastEditedTime: updated.last_edited_time
  };
}

const itemsPath = process.argv[2];
if (!itemsPath) {
  throw new Error("Usage: node tools/manual-douban-subject-update.mjs <items.json>");
}

const notion = new Client({ auth: dotenv("NOTION_TOKEN") });
const cookie = cookieHeader();
const items = JSON.parse(fs.readFileSync(itemsPath, "utf8"));
const results = [];
for (const item of items) {
  const result = await updateOne(notion, cookie, item);
  results.push(result);
  console.log(JSON.stringify(result));
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

console.log(JSON.stringify({ updated: results.length, results }, null, 2));
