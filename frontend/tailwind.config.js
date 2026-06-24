/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        // Brand
        primary: {
          DEFAULT: "#6366f1", // indigo-500 — brighter on dark bg
          dark: "#4f46e5",    // indigo-600
        },
        // Surfaces
        surface: "#111827",  // gray-900  — page bg, metric tiles
        panel:   "#1f2937",  // gray-800  — card bg
        divider: "#374151",  // gray-700  — card/table borders
        ink:     "#0d1117",  // near-black — header bg
        // Text scale
        subtle:  "#f9fafb",  // gray-50   — headings, card titles
        muted:   "#9ca3af",  // gray-400  — labels, chart axes
        faint:   "#6b7280",  // gray-500  — hints, range ends
      },
    },
  },
  plugins: [],
};
