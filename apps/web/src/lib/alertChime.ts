"use client";

import type { AlertSeverity } from "@strait-command/shared";

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** Resume after a user gesture — browsers often start AudioContext suspended */
export function unlockAlertAudio(): void {
  const c = ctx();
  if (c?.state === "suspended") void c.resume();
}

/** Short tonal cue for command stations */
export function playAlertChime(severity: AlertSeverity): void {
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);

  const freq =
    severity === "critical"
      ? 880
      : severity === "high"
        ? 720
        : severity === "medium"
          ? 560
          : 440;
  osc.frequency.value = freq;
  osc.type = "sine";

  const peak =
    severity === "critical"
      ? 0.12
      : severity === "high"
        ? 0.095
        : severity === "medium"
          ? 0.06
          : 0.045;

  const now = c.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

  osc.start(now);
  osc.stop(now + 0.42);
}
