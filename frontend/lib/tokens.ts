// Chart color constants — kept in sync with tailwind.config.js tokens.
// Import these into Recharts components instead of using raw hex strings.

export const CHART_COLORS = {
  spread: "#4f46e5",  // primary
  zscore: "#7c3aed",  // violet-600
  equity: "#16a34a",  // green-600
  entry:  "#ef4444",  // red-500  — z-score entry bands
  exit:   "#16a34a",  // green-600 — z-score exit bands
  grid:   "#f3f4f6",  // divider
  zero:   "#d1d5db",  // gray-300 — zero / baseline reference lines
} as const;

export const CHART_AXIS = {
  fontSize: 11,
  fill: "#6b7280",    // muted
} as const;
