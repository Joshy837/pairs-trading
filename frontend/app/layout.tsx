import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pairs Trading Dashboard",
  description: "Statistical arbitrage backtesting tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-surface min-h-screen">{children}</body>
    </html>
  );
}
