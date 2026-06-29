'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';

/**
 * The storefront pathways.
 * - 'guest':   the default for everyone (logged out OR a signed-in non-admin) →
 *              pays real money by card via Stripe. The shop is now parent-facing
 *              and everyone pays with dollars.
 * - 'student': legacy points pathway. No longer reached through normal auth — a
 *              signed-in non-admin now resolves to 'guest'. Kept in the type so
 *              the points machinery (admin mode, server spend) still compiles.
 * - 'admin':   a signed-in admin who has flipped on "show all products". Sees
 *              the FULL catalog (both points- and cash-priced items) and picks
 *              points or card per order at checkout. Opt-in: an admin who hasn't
 *              toggled it behaves like a normal cash shopper.
 *
 * Guest is the derived default. Admin mode is an explicit, per-browser toggle
 * (persisted in localStorage) available only to admins.
 */
export type Pathway = 'student' | 'guest' | 'admin';

const ADMIN_MODE_KEY = 'shop:adminMode';

export interface PathwayState {
    pathway: Pathway;
    isStudent: boolean;
    isGuest: boolean;
    /** True when the active pathway is the admin "see everything" view. */
    isAdminMode: boolean;
    /** True when the signed-in user is an admin (regardless of the toggle). */
    isAdmin: boolean;
    /** Flip the admin "show all products" view on/off (no-op for non-admins). */
    setAdminMode: (on: boolean) => void;
    /** Auth/admin status is still resolving; callers should avoid committing to a pathway yet. */
    loading: boolean;
}

export function usePathway(): PathwayState {
    const { status } = useSession();
    const authLoading = status === 'loading';
    const isSignedIn = status === 'authenticated';

    const [isAdmin, setIsAdmin] = useState(false);
    const [adminChecked, setAdminChecked] = useState(false);
    const [adminMode, setAdminModeState] = useState(false);

    // Restore the persisted toggle once on mount.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        setAdminModeState(window.localStorage.getItem(ADMIN_MODE_KEY) === '1');
    }, []);

    // Resolve admin status from the server whenever the user signs in. Logged-out
    // users are never admins; clear any stale flag.
    useEffect(() => {
        let cancelled = false;
        if (!isSignedIn) {
            setIsAdmin(false);
            setAdminChecked(!authLoading);
            return;
        }
        setAdminChecked(false);
        (async () => {
            try {
                const res = await fetch('/api/admin/me');
                const data = await res.json();
                if (!cancelled) setIsAdmin(Boolean(data?.isAdmin));
            } catch {
                if (!cancelled) setIsAdmin(false);
            } finally {
                if (!cancelled) setAdminChecked(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isSignedIn, authLoading]);

    const setAdminMode = useCallback((on: boolean) => {
        setAdminModeState(on);
        if (typeof window !== 'undefined') {
            if (on) window.localStorage.setItem(ADMIN_MODE_KEY, '1');
            else window.localStorage.removeItem(ADMIN_MODE_KEY);
        }
    }, []);

    // Admin mode only takes effect for a confirmed admin with the toggle on.
    const isAdminMode = isAdmin && adminMode;
    // Everyone pays with dollars now. A signed-in non-admin resolves to the
    // cash ('guest') pathway exactly like a logged-out shopper — only an admin
    // who has opted into "show all products" gets the points-capable view.
    const pathway: Pathway = isAdminMode ? 'admin' : 'guest';
    const isStudent = false;

    return {
        pathway,
        isStudent,
        isGuest: pathway === 'guest',
        isAdminMode,
        isAdmin,
        setAdminMode,
        // Don't commit to a pathway until BOTH auth and the admin check resolve,
        // so an admin with the toggle on never briefly renders the student view.
        loading: authLoading || (isSignedIn && !adminChecked),
    };
}
