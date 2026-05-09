"use client";

import { useLayoutEffect } from "react";
import { useFleetStore } from "@/store/fleetStore";

function ThemeSync() {
  const uiTheme = useFleetStore((s) => s.uiTheme);

  /** Apply before paint so Tailwind `dark:` variants match tactical theme immediately */
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", uiTheme === "dark");
  }, [uiTheme]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeSync />
      {children}
    </>
  );
}
