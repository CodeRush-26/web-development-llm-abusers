import { summarizeNewsText } from "./newsSummaryAi";

const MEDIASTACK_URL = "https://api.mediastack.com/v1/news";

export type StraitNewsItem = {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string | null;
  image: string | null;
  summary: string | null;
  bullets: string[];
};

type MediastackArticle = {
  title?: string;
  description?: string;
  url?: string;
  source?: string;
  image?: string | null;
  published_at?: string | null;
};

type CacheEntry = { at: number; items: StraitNewsItem[] };

let cache: CacheEntry | null = null;
/** Longer cache to stay under Mediastack free-tier / 429 limits */
const CACHE_MS = 12 * 60 * 1000;
const MAX_ARTICLES = 4;
const MEDIASTACK_RETRIES = 3;

export type StraitNewsResponse = {
  ok: boolean;
  error?: string;
  /** Set when we still return data but live fetch failed (e.g. 429) */
  warning?: string;
  items: StraitNewsItem[];
  fetchedAt: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function buildStraitNewsBrief(params: {
  mediastackKey: string | undefined;
  groqKey: string | undefined;
  skipCache?: boolean;
}): Promise<StraitNewsResponse> {
  const { mediastackKey, groqKey, skipCache } = params;
  const now = Date.now();

  if (!mediastackKey?.trim()) {
    return { ok: false, error: "mediastack_unconfigured", items: [], fetchedAt: now };
  }

  if (!skipCache && cache && now - cache.at < CACHE_MS) {
    return { ok: true, items: cache.items, fetchedAt: cache.at };
  }

  let articles: MediastackArticle[] = [];
  try {
    articles = await fetchMediastackArticles(mediastackKey.trim());
  } catch {
    if (cache?.items.length) {
      return {
        ok: true,
        warning: "live_feed_unavailable_cached",
        items: cache.items,
        fetchedAt: cache.at,
      };
    }
    return {
      ok: false,
      error: "mediastack_unavailable",
      items: [],
      fetchedAt: now,
    };
  }

  const sliced = articles.slice(0, MAX_ARTICLES);
  const items: StraitNewsItem[] = [];

  for (const a of sliced) {
    const title = String(a.title ?? "").trim() || "Untitled";
    const description = String(a.description ?? "").trim();
    let blob = `${title}\n\n${description}`;
    if (blob.trim().length < 80) {
      blob += "\n\nMaritime security context: Strait of Hormuz and Persian Gulf shipping.";
    }

    const ai = await summarizeWithCap(blob, groqKey);

    items.push({
      title,
      description,
      url: String(a.url ?? "").trim(),
      source: String(a.source ?? "").trim() || "Unknown source",
      publishedAt: a.published_at ? String(a.published_at) : null,
      image: a.image ? String(a.image) : null,
      summary: ai?.summary ?? null,
      bullets: ai?.bullets ?? [],
    });
  }

  cache = { at: now, items };
  return { ok: true, items, fetchedAt: now };
}

/** Cap each Groq call so one slow summary cannot exceed HTTP timeouts */
async function summarizeWithCap(
  blob: string,
  groqKey: string | undefined,
): Promise<Awaited<ReturnType<typeof summarizeNewsText>>> {
  if (!groqKey) return null;
  try {
    const result = await Promise.race([
      summarizeNewsText(blob, groqKey),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 14_000)),
    ]);
    return result;
  } catch {
    return null;
  }
}

async function fetchMediastackArticles(accessKey: string): Promise<MediastackArticle[]> {
  const u = new URL(MEDIASTACK_URL);
  u.searchParams.set("access_key", accessKey);
  u.searchParams.set("languages", "en");
  u.searchParams.set("sort", "published_desc");
  u.searchParams.set("limit", String(MAX_ARTICLES + 2));
  u.searchParams.set(
    "keywords",
    "strait of hormuz,persian gulf,oman sea,tanker shipping,tensions iran",
  );

  let lastStatus = 0;

  for (let attempt = 0; attempt < MEDIASTACK_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(2500 * attempt);
    }

    let res: Response;
    try {
      res = await fetch(u.toString(), {
        signal: AbortSignal.timeout(45_000),
        headers: { Accept: "application/json" },
      });
    } catch {
      lastStatus = 0;
      continue;
    }

    lastStatus = res.status;

    if (res.status === 429) {
      continue;
    }

    if (!res.ok) {
      throw new Error(`mediastack_http_${res.status}`);
    }

    const data = (await res.json()) as { data?: MediastackArticle[]; error?: { message?: string } };
    if (data.error?.message) {
      throw new Error(data.error.message);
    }
    return Array.isArray(data.data) ? data.data : [];
  }

  throw new Error(lastStatus === 429 ? "mediastack_rate_limited" : "mediastack_fetch_failed");
}
