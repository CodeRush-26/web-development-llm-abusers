"use client";

export default function NotFound() {
  return (
    <main className="flex h-[100dvh] w-full items-center justify-center bg-slate-950 text-slate-100">
      <div className="rounded-xl border border-white/10 bg-black/40 px-5 py-4 text-center">
        <div className="text-sm font-semibold">404</div>
        <p className="mt-1 text-xs text-slate-300">Page not found.</p>
      </div>
    </main>
  );
}

