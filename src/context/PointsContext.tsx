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

    const earnPoints = useCallback(async (amount: number, description?: string) => {
        if (status !== 'authenticated') return;

        try {
            const response = await fetch('/api/points/user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, description }),
            });

            if (response.ok) {
                const data = await response.json();
                setBalance(data.balance);
                setTransactions(prev => [{
                    ...data.transaction,
                    timestamp: new Date(data.transaction.timestamp)
                }, ...prev]);
            }
        } catch (error) {
            console.error('Failed to add points:', error);
        }
    }, [status]);

    const spendPoints = useCallback(async (amount: number, orderId?: string): Promise<boolean> => {
        if (status !== 'authenticated') return false;
        if (amount > balance) return false;

        try {
            const response = await fetch('/api/points/user', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, orderId }),
            });

            if (response.ok) {
                const data = await response.json();
                setBalance(data.balance);
                setTransactions(prev => [{
                    ...data.transaction,
                    timestamp: new Date(data.transaction.timestamp)
                }, ...prev]);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to spend points:', error);
            return false;
        }
    }, [status, balance]);

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
