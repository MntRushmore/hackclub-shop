'use client';

import { useSession } from 'next-auth/react';

/**
 * The two storefront pathways.
 * - 'student': signed in with Hack Club → pays with points.
 * - 'guest':   logged out → pays real money via an HCB donation.
 *
 * Pathway is derived purely from auth state; there is no manual toggle.
 */
export type Pathway = 'student' | 'guest';

export interface PathwayState {
    pathway: Pathway;
    isStudent: boolean;
    isGuest: boolean;
    /** Auth is still resolving; callers should avoid committing to a pathway yet. */
    loading: boolean;
}

export function usePathway(): PathwayState {
    const { status } = useSession();
    const loading = status === 'loading';
    const isStudent = status === 'authenticated';
    return {
        pathway: isStudent ? 'student' : 'guest',
        isStudent,
        isGuest: !isStudent,
        loading,
    };
}
