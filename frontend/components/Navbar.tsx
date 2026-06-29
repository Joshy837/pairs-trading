"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const path = usePathname();

  const linkCls = (href: string) =>
    `text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
      path === href ? "bg-primary/20 text-primary" : "text-muted hover:text-subtle"
    }`;

  return (
    <header className="bg-ink border-b border-divider">
      <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-subtle tracking-tight">Pairs Trading</span>
          <span className="text-xs text-faint ml-2 hidden sm:inline">
            Statistical arbitrage backtester
          </span>
        </div>
        <nav className="flex items-center gap-1">
          <Link href="/" className={linkCls("/")}>
            Backtest
          </Link>
          <Link href="/scanner" className={linkCls("/scanner")}>
            Scanner
          </Link>
          <Link href="/factor" className={linkCls("/factor")}>
            Factor
          </Link>
          <Link href="/universe" className={linkCls("/universe")}>
            Universe
          </Link>
        </nav>
      </div>
    </header>
  );
}
