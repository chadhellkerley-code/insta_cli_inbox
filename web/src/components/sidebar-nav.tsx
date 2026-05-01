"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/cuentas", label: "Cuentas" },
  { href: "/inbox", label: "Inbox" },
  { href: "/automatizaciones", label: "Automatizaciones" },
  { href: "/setting", label: "Setting" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label="Principal">
      {links.map((link) => {
        const active = pathname === link.href;

        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? "nav-link active" : "nav-link"}
          >
            <span className="nav-dot" aria-hidden="true" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
