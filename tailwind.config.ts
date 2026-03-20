import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "bg-primary": "#08080e",
        "bg-card": "rgba(255,255,255,0.02)",
        "bg-hover": "rgba(255,255,255,0.04)",
        "accent-green": "#00E676",
        "accent-red": "#FF5252",
        "accent-amber": "#FFD600",
        "accent-blue": "#3B82F6",
        "border-subtle": "rgba(255,255,255,0.06)",
        "border-hover": "rgba(255,255,255,0.12)",
        "text-primary": "#FFFFFF",
        "text-secondary": "rgba(255,255,255,0.6)",
        "text-muted": "rgba(255,255,255,0.35)",
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        card: "12px",
      },
    },
  },
  plugins: [],
};
export default config;
