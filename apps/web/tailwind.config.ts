import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        tactical: {
          bg: "#030712",
          panel: "rgba(8, 15, 35, 0.72)",
          cyan: "#22d3ee",
          amber: "#fbbf24",
          danger: "#ef4444",
          ok: "#34d399",
          muted: "#64748b",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(34, 211, 238, 0.25)",
        danger: "0 0 20px rgba(239, 68, 68, 0.35)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
