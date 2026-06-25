// Chart color constants — kept in sync with tailwind.config.js tokens.
// Import these into Recharts components instead of using raw hex strings.

export const CHART_COLORS = {
  spread: "#818cf8", // indigo-400  — brighter on dark
  zscore: "#a78bfa", // violet-400
  equity: "#4ade80", // green-400
  entry: "#f87171", // red-400     — z-score entry bands
  exit: "#4ade80", // green-400   — z-score exit bands
  grid: "#374151", // divider     — subtle dark grid
  zero: "#4b5563", // gray-600    — zero / baseline reference lines
  kalman: "#fb923c", // orange-400  — Kalman filter hedge ratio
} as const;

export const CHART_AXIS = {
  fontSize: 11,
  fill: "#9ca3af", // muted (gray-400, readable on dark)
} as const;
