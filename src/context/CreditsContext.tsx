'use client';

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { CreditTransaction, CreditsContextType } from '../types/Credits';

export const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

export const CreditsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { data: session, status } = useSession();
    const [balance, setBalance] = useState<number>(0);
    const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Fetch credits from API when user is authenticated
    const fetchCredits = useCallback(async () => {
        if (status !== 'authenticated' || !session?.user) return;

        setIsLoading(true);
        try {
            const response = await fetch('/api/credits/user');
            if (response.ok) {
                const data = await response.json();
                setBalance(data.balance || 0);
                const transactionsWithDates = (data.transactions || []).map((t: CreditTransaction) => ({
                    ...t,
                    timestamp: new Date(t.timestamp)
                }));
                setTransactions(transactionsWithDates);
            }
        } catch (error) {
            console.error('Failed to fetch credits:', error);
        } finally {
            setIsLoading(false);
            setIsInitialized(true);
        }
    }, [session?.user, status]);

    useEffect(() => {
        if (status === 'loading') return;

        if (status === 'authenticated') {
            const migrationDone = sessionStorage.getItem('user-data-migration-done');
            if (!migrationDone) {
                fetch('/api/migrate/user-data', { method: 'POST' })
                    .then(res => res.json())
                    .then(data => {
                        console.log('Migration result:', data);
                        sessionStorage.setItem('user-data-migration-done', 'true');
                        fetchCredits();
                    })
                    .catch(error => {
                        console.error('Migration failed:', error);
                        fetchCredits();
                    });
            } else {
                fetchCredits();
            }
        } else {
            // Not authenticated - reset to 0 and mark initialized
            setBalance(0);
            setTransactions([]);
            setIsInitialized(true);
        }
    }, [status, fetchCredits]);

    const addCredits = useCallback(async (amount: number, description?: string) => {
        if (status !== 'authenticated') {
            console.warn('Must be authenticated to add credits');
            return;
        }

        try {
            const response = await fetch('/api/credits/user', {
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
            console.error('Failed to add credits:', error);
        }
    }, [status]);

    const useCredits = useCallback(async (amount: number, orderId?: string): Promise<boolean> => {
        if (status !== 'authenticated') {
            console.warn('Must be authenticated to use credits');
            return false;
        }

        if (amount > balance) {
            return false;
        }

        try {
            const response = await fetch('/api/credits/user', {
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
            console.error('Failed to use credits:', error);
            return false;
        }
    }, [status, balance]);

    const canAfford = useCallback((amount: number): boolean => {
        return balance >= amount;
    }, [balance]);

    const refreshCredits = useCallback(async () => {
        await fetchCredits();
    }, [fetchCredits]);

    // Show loading state
    if (status === 'loading' || (status === 'authenticated' && !isInitialized)) {
        return (
            <CreditsContext.Provider value={{ balance: 0, transactions: [], addCredits, useCredits, canAfford, refreshCredits }}>
                {children}
            </CreditsContext.Provider>
        );
    }

    return (
        <CreditsContext.Provider value={{ balance, transactions, addCredits, useCredits, canAfford, refreshCredits, isLoading }}>
            {children}
        </CreditsContext.Provider>
    );
};
