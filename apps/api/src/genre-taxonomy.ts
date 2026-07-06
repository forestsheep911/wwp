export const canonicalGenreOptions = [
  { name: "剧情", color: "blue" },
  { name: "冒险", color: "orange" },
  { name: "动作", color: "red" },
  { name: "犯罪", color: "red" },
  { name: "惊悚", color: "purple" },
  { name: "喜剧", color: "yellow" },
  { name: "科幻", color: "purple" },
  { name: "动画", color: "pink" },
  { name: "浪漫", color: "pink" },
  { name: "悬疑", color: "purple" },
  { name: "奇幻", color: "purple" },
  { name: "家庭", color: "green" },
  { name: "战争", color: "red" },
  { name: "传记", color: "gray" },
  { name: "历史", color: "brown" },
  { name: "恐怖", color: "red" },
  { name: "记录", color: "gray" },
  { name: "音乐", color: "yellow" },
  { name: "运动", color: "green" },
  { name: "西部", color: "brown" },
  { name: "短片", color: "gray" },
  { name: "歌舞", color: "yellow" },
  { name: "黑色", color: "gray" },
  { name: "灾难", color: "orange" },
  { name: "真人秀", color: "green" },
  { name: "成人", color: "red" },
  { name: "游戏节目", color: "green" },
  { name: "新闻", color: "blue" },
  { name: "脱口秀", color: "yellow" }
];

const genreMap = new Map<string, string>([
  ["action", "动作"],
  ["adult", "成人"],
  ["adventure", "冒险"],
  ["animation", "动画"],
  ["biography", "传记"],
  ["comedy", "喜剧"],
  ["crime", "犯罪"],
  ["documentary", "记录"],
  ["drama", "剧情"],
  ["family", "家庭"],
  ["fantasy", "奇幻"],
  ["film-noir", "黑色"],
  ["film noir", "黑色"],
  ["game-show", "游戏节目"],
  ["game show", "游戏节目"],
  ["history", "历史"],
  ["horror", "恐怖"],
  ["music", "音乐"],
  ["musical", "歌舞"],
  ["mystery", "悬疑"],
  ["news", "新闻"],
  ["reality-tv", "真人秀"],
  ["reality tv", "真人秀"],
  ["romance", "浪漫"],
  ["sci-fi", "科幻"],
  ["science fiction", "科幻"],
  ["short", "短片"],
  ["sport", "运动"],
  ["sports", "运动"],
  ["talk-show", "脱口秀"],
  ["talk show", "脱口秀"],
  ["thriller", "惊悚"],
  ["war", "战争"],
  ["western", "西部"]
]);

function normalizeGenre(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function mapExternalGenres(values: string[]) {
  const canonical: string[] = [];
  const unmapped: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const mapped = genreMap.get(normalizeGenre(trimmed));
    if (mapped) {
      if (!canonical.includes(mapped)) canonical.push(mapped);
    } else if (!unmapped.includes(trimmed)) {
      unmapped.push(trimmed);
    }
  }

  return { canonical, unmapped };
}
