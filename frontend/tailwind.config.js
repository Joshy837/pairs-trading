/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        primary: {
          DEFAULT: "#4f46e5", // indigo-600
          dark: "#4338ca",    // indigo-700
        },
        // Surfaces
        surface: "#f9fafb",  // gray-50  — page bg, metric tiles
        panel:   "#ffffff",  // white    — card bg
        divider: "#f3f4f6",  // gray-100 — card/table borders
        // Text scale
        subtle:  "#374151",  // gray-700 — headings, card titles
        muted:   "#6b7280",  // gray-500 — labels, chart axes
        faint:   "#9ca3af",  // gray-400 — hints, range ends
      },
    },
  },
  plugins: [],
};
