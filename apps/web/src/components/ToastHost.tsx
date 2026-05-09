"use client";

import type { ReactElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useToastStore, type ToastVariant } from "@/store/toastStore";
import clsx from "clsx";

function toastClasses(v: ToastVariant): string {
  switch (v) {
    case "success":
      return "border-emerald-500/45 bg-emerald-950/90 text-emerald-50 shadow-emerald-900/30 dark:bg-emerald-950/85";
    case "warning":
      return "border-amber-500/45 bg-amber-950/90 text-amber-50 shadow-amber-900/25 dark:bg-amber-950/80";
    case "danger":
      return "border-red-500/50 bg-red-950/92 text-red-50 shadow-red-900/35";
    default:
      return "border-cyan-500/35 bg-slate-950/92 text-slate-100 shadow-black/40 dark:border-cyan-500/30";
  }
}

export function ToastHost(): ReactElement {
  const items = useToastStore((s) => s.items);

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-[200] flex max-w-[min(100vw-2rem,28rem)] -translate-x-1/2 flex-col gap-2 px-3"
      aria-live="polite"
      aria-relevant="additions"
    >
      <AnimatePresence mode="popLayout">
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={clsx(
              "pointer-events-auto rounded-xl border px-4 py-3 text-sm leading-snug shadow-xl backdrop-blur-md",
              toastClasses(t.variant),
            )}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
