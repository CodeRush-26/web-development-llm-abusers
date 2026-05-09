"use client";

import { create } from "zustand";

export type ToastVariant = "info" | "success" | "warning" | "danger";

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastStore {
  items: ToastItem[];
  pushToast: (message: string, variant?: ToastVariant) => void;
  dismissToast: (id: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  pushToast: (message, variant = "info") => {
    const id = `toast-${++seq}-${Date.now()}`;
    set((s) => ({
      items: [...s.items, { id, message, variant }].slice(-6),
    }));
    window.setTimeout(() => {
      set((s) => ({ items: s.items.filter((x) => x.id !== id) }));
    }, 5200);
  },
  dismissToast: (id) =>
    set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));
