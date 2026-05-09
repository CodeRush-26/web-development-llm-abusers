"use client";

import { fleetSocket } from "@/lib/socket";
import { useFleetStore } from "@/store/fleetStore";

export function PlaybackBar() {
  const playbackFrames = useFleetStore((s) => s.playbackFrames);
  const playbackIndex = useFleetStore((s) => s.playbackIndex);
  const setPlaybackIndex = useFleetStore((s) => s.setPlaybackIndex);
  const playbackActive = useFleetStore((s) => s.playbackActive);
  const setPlaybackActive = useFleetStore((s) => s.setPlaybackActive);
  const load = (): void => {
    fleetSocket.emit("playback:request");
  };

  const maxIdx = Math.max(0, playbackFrames.length - 1);

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-20 sm:bottom-4 sm:left-4 sm:right-4">
      <div className="glass-panel flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 shrink-0">
          <div className="text-xs font-semibold text-slate-900 dark:text-white">Replay</div>
          <p className="mt-0.5 max-w-xs text-[0.6875rem] leading-snug text-slate-600 dark:text-slate-500">
            Load saved snapshots, then scrub back in time (~30s steps).
          </p>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-3 font-mono text-[0.6875rem]">
          <button type="button" onClick={load} className="ui-btn-primary shrink-0 py-1.5 text-[0.6875rem]">
            Load history
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={playbackActive}
              onChange={(e) => setPlaybackActive(e.target.checked)}
              className="rounded border-slate-600 text-cyan-500 focus:ring-cyan-500/40"
            />
            <span>Preview playback</span>
          </label>
          <input
            type="range"
            min={0}
            max={maxIdx}
            value={playbackIndex != null ? Math.min(playbackIndex, maxIdx) : 0}
            disabled={!playbackFrames.length}
            onChange={(e) => setPlaybackIndex(Number(e.target.value))}
            className="min-w-[120px] flex-1 accent-cyan-400"
            aria-label="Playback position"
          />
          <span className="whitespace-nowrap text-slate-600 dark:text-slate-500">
            {playbackFrames.length
              ? `${playbackFrames.length} snapshots`
              : "No history loaded"}
          </span>
        </div>
      </div>
    </div>
  );
}
