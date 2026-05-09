"use client";

import { getFleetApiOrigin } from "@/lib/fleetApiOrigin";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState, type ReactElement } from "react";

type NewsItem = {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string | null;
  image: string | null;
  summary: string | null;
  bullets: string[];
};

type ApiPayload = {
  ok: boolean;
  error?: string;
  warning?: string;
  items: NewsItem[];
  fetchedAt: number;
};

export function StraitNewsStrip(): ReactElement {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const [staleNotice, setStaleNotice] = useState<string | null>(null);

  const load = useCallback(async (refresh?: boolean): Promise<void> => {
    setLoading(true);
    setErr(null);
    setStaleNotice(null);
    try {
      const base = getFleetApiOrigin();
      const q = refresh ? "?refresh=1" : "";
      const res = await fetch(`${base}/news/strait${q}`);
      const j = (await res.json()) as ApiPayload;
      if (!j.ok) {
        setErr(
          j.error === "mediastack_unconfigured"
            ? "News feed not configured — add MEDIASTACK_API_KEY to the API server .env (repo root) and restart. On Hugging Face: Space → Settings → Variables."
            : j.error === "mediastack_unavailable"
              ? "Mediastack is rate-limiting or unreachable. Wait a few minutes, avoid spamming Refresh, or upgrade your Mediastack plan."
              : "Could not load news",
        );
        setItems([]);
        return;
      }
      setItems(j.items ?? []);
      setFetchedAt(j.fetchedAt ?? null);
      if (j.warning === "live_feed_unavailable_cached") {
        setStaleNotice(
          "Showing cached headlines — live Mediastack feed failed (often HTTP 429 rate limit). Try again in several minutes.",
        );
      }
    } catch {
      setErr("Network error loading news");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(false);
  }, [open, load]);

  const onToggle = (): void => {
    setOpen((o) => !o);
  };

  return (
    <div className="pointer-events-none relative z-50 flex flex-col items-end gap-2">
      <div className="pointer-events-auto flex items-start gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="strait-news-panel"
          title={open ? "Hide Hormuz news" : "Show Hormuz news"}
          className={clsx(
            "relative flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur-xl transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-500/50",
            "border-slate-300/90 bg-white/90 text-slate-800",
            "dark:border-cyan-500/25 dark:bg-slate-950/90 dark:text-cyan-100",
            open && "ring-2 ring-cyan-500/35 dark:ring-cyan-400/30",
          )}
        >
          <span className="sr-only">{open ? "Collapse news" : "Expand news"}</span>
          <NewspaperIcon />
          <ChevronIcon collapsed={!open} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="strait-news-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="no-scrollbar pointer-events-auto flex max-h-[min(420px,42vh)] w-[min(100vw-2rem,380px)] flex-col gap-2 overflow-y-auto overscroll-contain pr-0.5"
          >
            <div className="rounded-xl border border-slate-300/90 bg-white/90 px-4 py-2.5 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/85">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Strait & Gulf news</h2>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-500">
                    Mediastack headlines · AI briefing (Groq) for Hormuz-relevant context
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void load(true)}
                  disabled={loading}
                  className="shrink-0 rounded-lg border border-cyan-600/50 px-2 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-wide text-cyan-800 transition hover:bg-cyan-500/10 disabled:opacity-50 dark:border-cyan-500/40 dark:text-cyan-200"
                >
                  {loading ? "…" : "Refresh"}
                </button>
              </div>
              {fetchedAt != null && (
                <p className="mt-1 font-mono text-[0.625rem] text-slate-500 dark:text-slate-500">
                  Updated {new Date(fetchedAt).toLocaleString()}
                </p>
              )}
            </div>

            {staleNotice && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                {staleNotice}
              </div>
            )}

            {err && (
              <div className="glass-panel border border-dashed border-amber-400/50 px-4 py-4 text-center text-sm text-amber-900 dark:border-amber-500/35 dark:text-amber-200">
                {err}
              </div>
            )}

            <AnimatePresence mode="popLayout">
            {loading && items.length === 0 && (
              <div className="glass-panel border border-slate-300/90 px-4 py-6 text-center text-sm text-slate-600 dark:border-slate-600 dark:text-slate-400">
                Loading regional headlines…
              </div>
            )}
              {items.map((item, idx) => (
                <motion.div
                  key={`${item.url}-${idx}`}
                  layout
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  className="glass-panel border border-slate-600/50 px-4 py-3 text-sm shadow-xl dark:border-slate-600/40"
                >
                  <div className="font-mono text-[0.6875rem] uppercase tracking-[0.15em] text-slate-500">
                    {item.source}
                    {item.publishedAt && (
                      <span className="ml-2 normal-case tracking-normal text-slate-400">
                        {new Date(item.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 block font-semibold leading-snug text-cyan-800 underline-offset-2 hover:underline dark:text-cyan-200"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <p className="mt-1.5 font-semibold leading-snug text-slate-900 dark:text-white">{item.title}</p>
                  )}
                  {(item.summary || item.bullets.length > 0) && (
                    <div className="mt-3 rounded-xl bg-black/45 p-3 text-xs text-cyan-50/95">
                      <div className="font-semibold text-cyan-300">AI summary · Hormuz context</div>
                      {item.summary && <p className="mt-2 leading-relaxed text-cyan-50/95">{item.summary}</p>}
                      {item.bullets.length > 0 && (
                        <ul className="mt-2 list-inside list-disc text-[11px] text-slate-200">
                          {item.bullets.map((b, bi) => (
                            <li key={bi}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {!item.summary && item.description && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{item.description}</p>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NewspaperIcon(): ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path
        fill="currentColor"
        d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7v-7zm4 0h6v2h-6v-2zm0 4h6v2h-6v-2zm0-8h6v2h-6V6z"
      />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden
      className={clsx("shrink-0 transition-transform", !collapsed && "rotate-180")}
    >
      <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
    </svg>
  );
}
