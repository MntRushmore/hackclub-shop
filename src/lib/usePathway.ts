'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';

/**
 * The storefront pathways.
 * - 'student': signed in with Hack Club → pays with points.
 * - 'guest':   logged out → pays real money via an HCB donation.
 * - 'admin':   a signed-in admin who has flipped on "show all products". Sees
 *              the FULL catalog (both points- and cash-priced items) and picks
 *              points or HCB per order at checkout. Opt-in: an admin who hasn't
 *              toggled it behaves exactly like a normal 'student'.
 *
 * Student/guest are derived purely from auth state. Admin mode is an explicit,
 * per-browser toggle (persisted in localStorage) available only to admins.
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
    const isStudent = isSignedIn && !isAdminMode;
    const pathway: Pathway = !isSignedIn ? 'guest' : isAdminMode ? 'admin' : 'student';

    return {
        pathway,
        isStudent,
        isGuest: !isSignedIn,
        isAdminMode,
        isAdmin,
        setAdminMode,
        // Don't commit to a pathway until BOTH auth and the admin check resolve,
        // so an admin with the toggle on never briefly renders the student view.
        loading: authLoading || (isSignedIn && !adminChecked),
    };
}
