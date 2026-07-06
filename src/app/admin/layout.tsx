'use client';

import { useState, useEffect, ReactNode } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AdminProvider, AdminInfo } from './ui';
import type { AdminPermissions } from '../../types/Admin';

/**
 * One gate, one nav. Every /admin page renders inside this shell: the layout
 * checks the session and admin role once, then provides role + permissions via
 * useAdmin(). Pages must not roll their own signIn redirects or /api/admin/me
 * fetches. The sidebar is hidden in print so label sheets print clean.
 */

interface NavItem {
    href: string;
    label: string;
    permission?: keyof AdminPermissions;
    external?: boolean;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
    {
        group: 'Store',
        items: [
            { href: '/admin', label: 'Overview' },
            { href: '/admin/orders', label: 'Orders' },
            { href: 'https://dashboard.stripe.com/products', label: 'Products', external: true },
            { href: '/admin/coupons', label: 'Coupons', permission: 'canManageCoupons' },
            { href: '/admin/projects', label: 'Projects' },
            { href: '/admin/feedback', label: 'Feedback calls' },
        ],
    },
    {
        group: 'Money',
        items: [
            { href: '/admin/stats', label: 'Statistics', permission: 'canViewStats' },
            { href: '/admin/finance', label: 'Finance', permission: 'canManageFinance' },
        ],
    },
    {
        group: 'Access',
        items: [
            { href: '/admin/users', label: 'Users', permission: 'canManageUsers' },
            { href: '/admin/admins', label: 'Admins', permission: 'canManageAdmins' },
            { href: '/admin/audit', label: 'Audit log' },
        ],
    },
];

function isActive(pathname: string, href: string) {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(href + '/');
}

function NavLink({ item, pathname, compact }: { item: NavItem; pathname: string; compact?: boolean }) {
    const active = !item.external && isActive(pathname, item.href);
    const base = compact
        ? 'whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold'
        : 'block rounded-md px-3 py-1.5 text-sm font-bold';
    const tone = active
        ? 'bg-hackclub-red/10 text-hackclub-red'
        : 'text-hackclub-slate hover:bg-gray-100 hover:text-hackclub-dark';
    if (item.external) {
        return (
            <a href={item.href} target="_blank" rel="noopener noreferrer" className={`${base} ${tone}`}>
                {item.label} ↗
            </a>
        );
    }
    return (
        <Link href={item.href} className={`${base} ${tone}`}>
            {item.label}
        </Link>
    );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
    const { data: session, status } = useSession();
    const pathname = usePathname() || '/admin';
    const [admin, setAdmin] = useState<AdminInfo | null>(null);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        if (status === 'unauthenticated') signIn('hackclub', { callbackUrl: pathname });
    }, [status, pathname]);

    useEffect(() => {
        if (!session?.user?.id) return;
        (async () => {
            try {
                const me = await fetch('/api/admin/me').then((r) => r.json());
                if (me?.isAdmin) setAdmin({ role: me.role, permissions: me.permissions });
            } catch {
                // treated as not-admin below
            } finally {
                setChecked(true);
            }
        })();
    }, [session?.user?.id]);

    if (status === 'loading' || !session || !checked) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <p className="text-sm font-bold text-hackclub-slate">Loading…</p>
            </div>
        );
    }

    if (!admin) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
                <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                    <h2 className="mb-2 text-xl font-black text-hackclub-dark">Access denied</h2>
                    <p className="mb-6 text-sm text-hackclub-slate">
                        You don&apos;t have permission to access the admin dashboard.
                    </p>
                    <Link
                        href="/"
                        className="inline-block rounded-full bg-hackclub-red px-6 py-2.5 text-sm font-black text-white hover:bg-hackclub-orange"
                    >
                        Back to shop
                    </Link>
                </div>
            </div>
        );
    }

    const groups = NAV.map((g) => ({
        ...g,
        items: g.items.filter((it) => !it.permission || admin.permissions[it.permission]),
    })).filter((g) => g.items.length > 0);
    const flat = groups.flatMap((g) => g.items);

    return (
        <AdminProvider value={admin}>
            <div className="min-h-screen bg-gray-50">
                {/* Mobile: horizontal nav under the global header */}
                <nav className="sticky top-16 z-20 flex gap-1 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2 lg:hidden print:hidden">
                    {flat.map((it) => (
                        <NavLink key={it.href} item={it} pathname={pathname} compact />
                    ))}
                </nav>

                <div className="mx-auto flex max-w-screen-2xl">
                    {/* Desktop sidebar */}
                    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-white px-3 py-6 lg:block print:hidden">
                        {groups.map((g) => (
                            <div key={g.group} className="mb-5">
                                <p className="mb-1 px-3 text-[11px] font-black uppercase tracking-wider text-gray-400">{g.group}</p>
                                <div className="space-y-0.5">
                                    {g.items.map((it) => (
                                        <NavLink key={it.href} item={it} pathname={pathname} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </aside>

                    <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8 print:p-0">
                        <div className="mx-auto max-w-6xl print:max-w-none">{children}</div>
                    </main>
                </div>
            </div>
        </AdminProvider>
    );
}
