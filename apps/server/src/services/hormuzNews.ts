type GuardianSearchResponse = {
  response?: {
    status?: string;
    results?: Array<{
      id: string;
      webTitle: string;
      webUrl: string;
      webPublicationDate?: string;
      sectionName?: string;
      fields?: {
        trailText?: string;
        bodyText?: string;
      };
    }>;
  };
};

export type HormuzNewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  /** Publisher-provided preview (not AI). */
  excerpt: string | null;
  /** Full-ish text (if available) used for AI summarization. */
  contentText: string | null;
};

type MediastackResponse = {
  data?: Array<{
    author?: string | null;
    title?: string | null;
    description?: string | null;
    url?: string | null;
    source?: string | null;
    image?: string | null;
    category?: string | null;
    language?: string | null;
    country?: string | null;
    published_at?: string | null;
  }>;
};

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchHormuzNews(params: {
  limit: number;
  mediastackApiKey?: string;
  guardianApiKey?: string;
}): Promise<HormuzNewsItem[]> {
  const limit = Math.max(1, Math.min(12, Math.floor(params.limit)));

  if (params.mediastackApiKey) {
    const keywords = encodeURIComponent('"Strait of Hormuz",Hormuz');
    const url =
      "http://api.mediastack.com/v1/news" +
      `?access_key=${encodeURIComponent(params.mediastackApiKey)}` +
      `&keywords=${keywords}` +
      `&languages=en` +
      `&sort=published_desc` +
      `&limit=${limit}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(12_500) });
    if (!res.ok) throw new Error(`mediastack_http_${res.status}`);
    const data = (await res.json()) as MediastackResponse;
    const items = data.data ?? [];

    return items
      .filter((it) => it.title && it.url)
      .map((it, idx) => {
        const desc = it.description ? stripHtml(it.description) : null;
        const publishedAt = it.published_at ?? null;
        const source = it.source ? `Mediastack · ${it.source}` : "Mediastack";
        return {
          id: `mediastack:${publishedAt ?? "na"}:${idx}`,
          title: it.title ?? "Untitled",
          url: it.url ?? "",
          source,
          publishedAt,
          excerpt: desc,
          contentText: desc,
        };
      });
  }

  if (params.guardianApiKey) {
    const q = encodeURIComponent('"Strait of Hormuz" OR Hormuz');
    const url =
      "https://content.guardianapis.com/search" +
      `?q=${q}` +
      `&page-size=${limit}` +
      `&order-by=newest` +
      `&show-fields=trailText,bodyText` +
      `&api-key=${encodeURIComponent(params.guardianApiKey)}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(12_500) });
    if (!res.ok) throw new Error(`guardian_http_${res.status}`);
    const data = (await res.json()) as GuardianSearchResponse;
    const results = data.response?.results ?? [];

    return results.map((r) => {
      const trail = r.fields?.trailText ? stripHtml(r.fields.trailText) : null;
      const body = r.fields?.bodyText ? stripHtml(r.fields.bodyText) : null;
      const contentText = body && body.length > 40 ? body : trail;
      return {
        id: `guardian:${r.id}`,
        title: r.webTitle,
        url: r.webUrl,
        source: r.sectionName ? `The Guardian · ${r.sectionName}` : "The Guardian",
        publishedAt: r.webPublicationDate ?? null,
        excerpt: trail,
        contentText,
      };
    });
  }

  /**
   * Fallback: GDELT 2.1 doc API (no key). It’s an aggregator (not a single channel),
   * but keeps the UI functional in dev when no Guardian key is set.
   */
  const gdeltQ = encodeURIComponent('"Strait of Hormuz" OR Hormuz');
  const gdeltUrl =
    "https://api.gdeltproject.org/api/v2/doc/doc" +
    `?query=${gdeltQ}` +
    `&mode=ArtList` +
    `&format=json` +
    `&sort=HybridRel` +
    `&maxrecords=${limit}`;

  const res = await fetch(gdeltUrl, { signal: AbortSignal.timeout(12_500) });
  if (!res.ok) throw new Error(`gdelt_http_${res.status}`);
  const data = (await res.json()) as {
    articles?: Array<{
      url?: string;
      title?: string;
      sourceCountry?: string;
      domain?: string;
      seendate?: string;
      socialimage?: string;
      language?: string;
    }>;
  };

  const articles = data.articles ?? [];
  return articles
    .filter((a) => a.url && a.title)
    .map((a, idx) => ({
      id: `gdelt:${idx}:${a.domain ?? "unknown"}`,
      title: a.title ?? "Untitled",
      url: a.url ?? "",
      source: a.domain ? `GDELT · ${a.domain}` : "GDELT",
      publishedAt: a.seendate ?? null,
      excerpt: null,
      contentText: null,
    }));
}

