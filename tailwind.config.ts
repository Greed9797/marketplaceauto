import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "./tests/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        w3: {
          red: "var(--w3-red)",
          "red-hover": "var(--w3-red-hover)",
          gold: "var(--w3-gold)",
        },
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
    },
  },
};

export default config;
