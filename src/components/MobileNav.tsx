'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// ============================================================
// Mobile bottom navigation (small screens only).
// Big, prominent brutalist icon chips — inline SVGs (no icon
// dependency), active page highlighted with the signal fill +
// hard offset shadow per design.md §1/§4.1.
// ============================================================

const ICON_PROPS = {
  width: 26,
  height: 26,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
  'aria-hidden': true,
};

function DashboardIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 11.5 12 3.5l9 8" />
      <path d="M5.5 10v10h13V10" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="6.5" y="2.75" width="11" height="18.5" rx="1.5" />
      <path d="M10.5 5.5h3" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </svg>
  );
}

const ITEMS = [
  { href: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { href: '/dashboard/devices', label: 'Devices', Icon: DevicesIcon },
  { href: '/dashboard/settings', label: 'Settings', Icon: SettingsIcon },
];

export default function MobileNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname.startsWith('/dashboard/subjects');
    }
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <nav className="hide-on-desktop mobile-nav" aria-label="Primary">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={`mobile-nav__item${active ? ' mobile-nav__item--active' : ''}`}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
          >
            <Icon />
            <span className="mobile-nav__label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
