import type { Alert, Ship } from "@strait-command/shared";

/**
 * Stable fallbacks for Zustand selectors.
 * Never use `?? []` inline — a fresh [] each read breaks React 19 / useSyncExternalStore.
 */
export const EMPTY_ALERTS: Alert[] = [];
export const EMPTY_SHIPS: Ship[] = [];
