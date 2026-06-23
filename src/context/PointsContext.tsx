'use client';

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { PointsTransaction, PointsContextType } from '../types/Points';

export const PointsContext = createContext<PointsContextType | undefined>(undefined);

export const PointsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { data: session, status } = useSession();
    const [balance, setBalance] = useState<number>(0);
    const [transactions, setTransactions] = useState<PointsTransaction[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const fetchPoints = useCallback(async () => {
        if (status !== 'authenticated' || !session?.user) return;

        setIsLoading(true);
        try {
            const response = await fetch('/api/points/user');
            if (response.ok) {
                const data = await response.json();
                setBalance(data.balance || 0);
                const txWithDates = (data.transactions || []).map((t: PointsTransaction) => ({
                    ...t,
                    timestamp: new Date(t.timestamp)
                }));
                setTransactions(txWithDates);
            }
        } catch (error) {
            console.error('Failed to fetch points:', error);
        } finally {
            setIsLoading(false);
            setIsInitialized(true);
        }
    }, [session?.user, status]);

    useEffect(() => {
        if (status === 'loading') return;

        if (status === 'authenticated') {
            fetchPoints();
        } else {
            setBalance(0);
            setTransactions([]);
            setIsInitialized(true);
        }
    }, [status, fetchPoints]);

    // Points are money-equivalent (1 point = $1) and may only be mutated by
    // trusted server-side flows: admin grants / project approval for earning,
    // and order creation (/api/orders) for spending. There is no client-writable
    // points endpoint. earnPoints/spendPoints are kept as no-ops for backward
    // compatibility with the context type; call refreshPoints() after an order
    // to pull the authoritative server balance.
    const earnPoints = useCallback(async () => {
        // Earning happens server-side only. Refresh to reflect any new balance.
        await fetchPoints();
    }, [fetchPoints]);

    const spendPoints = useCallback(async (amount: number): Promise<boolean> => {
        // Spending is handled atomically inside order creation server-side.
        // Refresh to reflect the post-order balance; never mutate locally.
        await fetchPoints();
        return amount <= balance;
    }, [fetchPoints, balance]);

    const canAfford = useCallback((amount: number) => balance >= amount, [balance]);

    const refreshPoints = useCallback(async () => {
        await fetchPoints();
    }, [fetchPoints]);

    if (status === 'loading' || (status === 'authenticated' && !isInitialized)) {
        return (
            <PointsContext.Provider value={{ balance: 0, transactions: [], earnPoints, spendPoints, canAfford, refreshPoints }}>
                {children}
            </PointsContext.Provider>
        );
    }

    return (
        <PointsContext.Provider value={{ balance, transactions, earnPoints, spendPoints, canAfford, refreshPoints, isLoading }}>
            {children}
        </PointsContext.Provider>
    );
};
