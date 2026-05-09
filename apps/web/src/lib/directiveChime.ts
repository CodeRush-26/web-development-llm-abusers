"use client";

import { unlockAlertAudio } from "@/lib/alertChime";

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** Ascending two-tone cue — distinct from hazard alerts */
export function playDirectiveChime(): void {
  unlockAlertAudio();
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();

  const now = c.currentTime;

  const tone = (freq: number, start: number, dur: number, peak: number): void => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  };

  tone(520, now, 0.14, 0.07);
  tone(740, now + 0.11, 0.16, 0.085);
}
