"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/input",           label: "intake" },
  { href: "/team-design",     label: "team" },
  { href: "/cost-estimation", label: "cost" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 bg-[var(--bg)] border-b-strong">
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        
        {/* Logo */}
        <div className="p-6 border-b-strong lg:border-b-0 lg:border-r-strong flex items-center justify-center min-w-[240px]">
          <Link href="/" className="font-display text-3xl font-bold italic tracking-tight">
            ScopeSense
          </Link>
        </div>

        {/* Nav Links */}
        <nav className="flex flex-1 overflow-x-auto">
          {navigation.map((item, i) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 min-w-[120px] p-6 text-center border-r-strong font-sans text-sm font-bold tracking-widest uppercase transition-colors hover:bg-[var(--bg-2)] ${
                  active ? "bg-[var(--text-heading)] text-[var(--bg)] hover:bg-[var(--text-heading)]" : ""
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden lg:flex items-center justify-center p-6 bg-[var(--bg-2)] min-w-[200px]">
          <span className="sans-label">Studio Mode</span>
        </div>
      </div>
    </header>
  );
}
