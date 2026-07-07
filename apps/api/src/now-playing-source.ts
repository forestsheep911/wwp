import type { NowPlayingMovie, NowPlayingResponse, UpcomingMovie } from "@wwpdw/shared";

const sourceUrl = "https://piaofang.maoyan.com/dashboard/movie";
const ajaxUrl = "https://piaofang.maoyan.com/dashboard-ajax?orderType=0";
const doubanNowPlayingUrl = "https://movie.douban.com/cinema/nowplaying/shanghai/";
const doubanLaterUrl = "https://movie.douban.com/cinema/later/shanghai/";
const ttlSeconds = Math.max(60, Math.floor(Number(process.env.NOW_PLAYING_CACHE_TTL_SECONDS ?? 1800)));
const requestTimeoutMs = Math.max(1000, Math.floor(Number(process.env.NOW_PLAYING_REQUEST_TIMEOUT_MS ?? 8000)));
const movieLimit = Math.min(30, Math.max(1, Math.floor(Number(process.env.NOW_PLAYING_LIMIT ?? 12))));
const upcomingMovieLimit = Math.min(30, Math.max(1, Math.floor(Number(process.env.NOW_PLAYING_UPCOMING_LIMIT ?? 12))));

let cachedResponse: NowPlayingResponse | undefined;
let cachedAtMs = 0;
let pendingRefresh: Promise<NowPlayingResponse> | undefined;

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function cloneResponse(response: NowPlayingResponse): NowPlayingResponse {
  return JSON.parse(JSON.stringify(response)) as NowPlayingResponse;
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function normalizedTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[《》“”"'\s:：·・,，.。!！?？/／|｜\-—_()（）[\]【】]/g, "")
    .trim();
}

function parseAttributes(value: string) {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeHtml(match[2]);
  }
  return attributes;
}

function numberFromString(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cacheFresh() {
  return Boolean(cachedResponse && Date.now() - cachedAtMs < ttlSeconds * 1000);
}

function parseMovie(item: unknown, index: number): NowPlayingMovie | undefined {
  const row = recordValue(item);
  const movieInfo = recordValue(row.movieInfo);
  const movieId = movieInfo.movieId;
  const id = typeof movieId === "number" || typeof movieId === "string" ? String(movieId) : "";
  const title = stringValue(movieInfo.movieName);

  if (!id || !title) {
    return undefined;
  }

  return {
    id,
    title,
    releaseInfo: stringValue(movieInfo.releaseInfo),
    rank: index + 1,
    boxRate: stringValue(row.boxRate),
    splitBoxRate: stringValue(row.splitBoxRate),
    showCount: numberValue(row.showCount),
    showCountRate: stringValue(row.showCountRate),
    avgShowView: stringValue(row.avgShowView),
    avgSeatView: stringValue(row.avgSeatView),
    totalBoxOffice: stringValue(row.sumBoxDesc),
    totalSplitBoxOffice: stringValue(row.sumSplitBoxDesc),
    sourceUrl: `${sourceUrl}?movieId=${encodeURIComponent(id)}`,
    ticketUrl: `https://www.maoyan.com/films/${encodeURIComponent(id)}`
  };
}

function parseMaoyanPayload(payload: unknown): NowPlayingResponse {
  const root = recordValue(payload);
  const movieList = recordValue(root.movieList);
  const data = recordValue(movieList.data);
  const list = Array.isArray(data.list) ? data.list : [];
  const calendar = recordValue(root.calendar);
  const movies = list
    .slice(0, movieLimit)
    .map(parseMovie)
    .filter((movie): movie is NowPlayingMovie => Boolean(movie));

  if (movies.length === 0) {
    throw new Error("Maoyan now-playing payload did not include movie rows.");
  }

  return {
    source: "maoyan",
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    observedAt: stringValue(calendar.serverTimestamp) ?? stringValue(calendar.today),
    cache: {
      status: "refresh",
      ttlSeconds
    },
    movies
  };
}

interface DoubanNowPlayingEntry {
  subjectId: string;
  title: string;
  url: string;
  rating?: string;
  voteCount?: number;
  releaseYear?: string;
  duration?: string;
  region?: string;
  director?: string;
  actors?: string;
}

interface DoubanPayload {
  nowPlaying: DoubanNowPlayingEntry[];
  upcoming: UpcomingMovie[];
  fetchedAt: string;
}

function parseDoubanNowPlaying(html: string): DoubanNowPlayingEntry[] {
  const entries: DoubanNowPlayingEntry[] = [];
  for (const match of html.matchAll(/<li\s+id="([^"]+)"([^>]*\bclass="[^"]*\blist-item\b[^"]*"[^>]*)>/g)) {
    const subjectId = match[1];
    const attributes = parseAttributes(match[2]);
    const title = attributes["data-title"];
    if (!subjectId || !title) {
      continue;
    }

    const score = attributes["data-score"];
    const voteCount = numberFromString(attributes["data-votecount"]);
    entries.push({
      subjectId,
      title,
      url: `https://movie.douban.com/subject/${encodeURIComponent(subjectId)}/`,
      rating: score && score !== "0" ? score : undefined,
      voteCount,
      releaseYear: attributes["data-release"],
      duration: attributes["data-duration"],
      region: attributes["data-region"],
      director: attributes["data-director"],
      actors: attributes["data-actors"]
    });
  }

  return entries;
}

function parseDoubanUpcoming(html: string): UpcomingMovie[] {
  return html
    .split(/<div class="item mod[^>]*>/)
    .slice(1)
    .map((block) => {
      const subjectMatch = block.match(/href="https:\/\/movie\.douban\.com\/subject\/(\d+)\/"/);
      const titleMatch = block.match(/<h3>[\s\S]*?<a href="https:\/\/movie\.douban\.com\/subject\/\d+\/"[^>]*>([\s\S]*?)<\/a>/);
      const dtValues = [...block.matchAll(/<li class="dt(?: last)?">([\s\S]*?)<\/li>/g)].map((match) => stripTags(match[1]));
      const wantMatch = block.match(/(\d+)人想看/);
      const trailerMatch = block.match(/<a href="([^"]+)" class="trailer_icon"/);
      const id = subjectMatch?.[1];
      const title = titleMatch ? stripTags(titleMatch[1]) : "";
      const releaseDate = dtValues[0];

      if (!id || !title || !releaseDate) {
        return undefined;
      }

      const movie: UpcomingMovie = {
        id,
        title,
        releaseDate,
        genres: dtValues[1] ? dtValues[1].split("/").map((item) => item.trim()).filter(Boolean) : [],
        sourceUrl: `https://movie.douban.com/subject/${encodeURIComponent(id)}/`
      };
      const region = dtValues[2];
      const wishCount = numberFromString(wantMatch?.[1]);
      const trailerUrl = trailerMatch ? decodeHtml(trailerMatch[1]) : undefined;

      if (region) {
        movie.region = region;
      }
      if (wishCount !== undefined) {
        movie.wishCount = wishCount;
      }
      if (trailerUrl) {
        movie.trailerUrl = trailerUrl;
      }

      return movie;
    })
    .filter((movie): movie is UpcomingMovie => Boolean(movie))
    .slice(0, upcomingMovieLimit);
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    },
    signal: AbortSignal.timeout(requestTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Douban request failed with ${response.status}.`);
  }

  return response.text();
}

async function fetchDoubanPayload(): Promise<DoubanPayload> {
  const [nowPlayingHtml, upcomingHtml] = await Promise.all([
    fetchText(doubanNowPlayingUrl),
    fetchText(doubanLaterUrl)
  ]);

  return {
    nowPlaying: parseDoubanNowPlaying(nowPlayingHtml),
    upcoming: parseDoubanUpcoming(upcomingHtml),
    fetchedAt: new Date().toISOString()
  };
}

function enrichWithDouban(response: NowPlayingResponse, douban: DoubanPayload): NowPlayingResponse {
  const byTitle = new Map(douban.nowPlaying.map((entry) => [normalizedTitle(entry.title), entry]));
  return {
    ...response,
    douban: {
      sourceUrl: doubanNowPlayingUrl,
      laterSourceUrl: doubanLaterUrl,
      fetchedAt: douban.fetchedAt,
      city: "shanghai",
      nowPlayingCount: douban.nowPlaying.length
    },
    movies: response.movies.map((movie) => ({
      ...movie,
      douban: byTitle.get(normalizedTitle(movie.title))
    })),
    upcomingMovies: douban.upcoming
  };
}

async function fetchMaoyanNowPlaying() {
  const response = await fetch(ajaxUrl, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "referer": sourceUrl,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    },
    signal: AbortSignal.timeout(requestTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Maoyan now-playing request failed with ${response.status}.`);
  }

  return parseMaoyanPayload(await response.json());
}

async function refreshNowPlaying() {
  const response = await fetchMaoyanNowPlaying();
  let nextResponse = response;
  try {
    nextResponse = enrichWithDouban(response, await fetchDoubanPayload());
  } catch (error) {
    nextResponse = {
      ...response,
      degraded: true,
      warning: error instanceof Error ? error.message : String(error)
    };
  }

  cachedResponse = nextResponse;
  cachedAtMs = Date.now();
  return nextResponse;
}

export async function getNowPlaying(options: { forceRefresh?: boolean } = {}): Promise<NowPlayingResponse> {
  if (!options.forceRefresh && cacheFresh() && cachedResponse) {
    return {
      ...cloneResponse(cachedResponse),
      cache: {
        ...cachedResponse.cache,
        status: "hit"
      }
    };
  }

  pendingRefresh ??= refreshNowPlaying().finally(() => {
    pendingRefresh = undefined;
  });

  try {
    return cloneResponse(await pendingRefresh);
  } catch (error) {
    if (cachedResponse) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...cloneResponse(cachedResponse),
        cache: {
          ...cachedResponse.cache,
          status: "stale"
        },
        degraded: true,
        warning: message
      };
    }

    throw error;
  }
}
