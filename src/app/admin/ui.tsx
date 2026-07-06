'use client';

import { createContext, useContext, ReactNode } from 'react';
import type { AdminRole, AdminPermissions } from '../../types/Admin';

/**
 * Shared chrome for every admin page. The layout gates auth once and provides
 * the current admin's role + permissions here, so pages never re-fetch
 * /api/admin/me or roll their own session checks. Keep these primitives small:
 * one header, one card, one error banner, one empty state.
 */

export interface AdminInfo {
    role: AdminRole;
    permissions: AdminPermissions;
}

const AdminContext = createContext<AdminInfo | null>(null);

export function AdminProvider({ value, children }: { value: AdminInfo; children: ReactNode }) {
    return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

/** Current admin's role + permissions. Only usable under /admin (the layout provides it). */
export function useAdmin(): AdminInfo {
    const ctx = useContext(AdminContext);
    if (!ctx) throw new Error('useAdmin must be used inside the admin layout');
    return ctx;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
    return (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
                <h1 className="text-2xl font-black text-hackclub-dark">{title}</h1>
                {subtitle && <p className="mt-1 text-sm text-hackclub-slate">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
}

export function Card({ children, className = '', padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
    return (
        <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${padded ? 'p-5' : ''} ${className}`}>
            {children}
        </div>
    );
}

export function ErrorBanner({ message }: { message: string }) {
    return (
        <div className="mb-4 rounded-lg border border-hackclub-red/30 bg-hackclub-red/5 px-4 py-3">
            <p className="text-sm font-bold text-hackclub-red">{message}</p>
        </div>
    );
}

export function EmptyState({ message }: { message: string }) {
    return (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
            <p className="text-sm font-medium text-hackclub-slate">{message}</p>
        </div>
    );
}

export function LoadingScreen() {
    return (
        <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-sm font-bold text-hackclub-slate">Loading…</p>
        </div>
    );
}
