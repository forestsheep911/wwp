type GenreTone =
  | "drama"
  | "mystery"
  | "scifi"
  | "thriller"
  | "horror"
  | "comedy"
  | "romance"
  | "action"
  | "crime"
  | "fantasy"
  | "animation"
  | "documentary"
  | "history"
  | "family"
  | "music"
  | "war"
  | "western";

const genreTonePatterns: Array<{ tone: GenreTone; pattern: RegExp }> = [
  { tone: "scifi", pattern: /科幻|science\s*fiction|sci[-\s]?fi|未来|太空|space/ },
  { tone: "mystery", pattern: /悬疑|懸疑|mystery|推理|谜|謎|侦探|偵探/ },
  { tone: "thriller", pattern: /惊悚|驚悚|thriller|心理/ },
  { tone: "horror", pattern: /恐怖|horror|怪谈|怪談|灵异|靈異/ },
  { tone: "drama", pattern: /剧情|劇情|drama|文艺|文藝/ },
  { tone: "comedy", pattern: /喜剧|喜劇|comedy|搞笑/ },
  { tone: "romance", pattern: /爱情|愛情|romance|love/ },
  { tone: "action", pattern: /动作|動作|action|冒险|冒險|adventure/ },
  { tone: "crime", pattern: /犯罪|crime|黑帮|黑幫|警匪|noir/ },
  { tone: "fantasy", pattern: /奇幻|fantasy|魔幻|神话|神話/ },
  { tone: "animation", pattern: /动画|動畫|动漫|動漫|animation|anime/ },
  { tone: "documentary", pattern: /纪录|紀錄|documentary|docu/ },
  { tone: "history", pattern: /历史|歷史|history|传记|傳記|biography/ },
  { tone: "family", pattern: /家庭|family|儿童|兒童|kids/ },
  { tone: "music", pattern: /音乐|音樂|music|歌舞|musical/ },
  { tone: "war", pattern: /战争|戰爭|war|军事|軍事/ },
  { tone: "western", pattern: /西部|western/ }
];

function normalizeGenreTag(tag: string) {
  return tag.trim().toLowerCase();
}

export function genreTone(tag: string): GenreTone | "default" {
  const normalized = normalizeGenreTag(tag);
  return genreTonePatterns.find(({ pattern }) => pattern.test(normalized))?.tone ?? "default";
}

export function genreBadgeClass(tag: string) {
  return `genre-badge genre-badge-${genreTone(tag)}`;
}
