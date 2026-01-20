'use client';

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { CreditTransaction, CreditsContextType } from '../types/Credits';

export const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

export const CreditsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [balance, setBalance] = useState<number>(0);
    const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);
    useEffect(() => {
        const savedBalance = localStorage.getItem('credits_balance');
        const savedTransactions = localStorage.getItem('credits_transactions');

        if (savedBalance) {
            setBalance(parseFloat(savedBalance));
        }
        if (savedTransactions) {
            const parsed = JSON.parse(savedTransactions);
            const withDates = parsed.map((t: CreditTransaction) => ({
                ...t,
                timestamp: new Date(t.timestamp)
            }));
            setTransactions(withDates);
        }
        setIsInitialized(true);
    }, []);

    useEffect(() => {
        if (isInitialized) {
            localStorage.setItem('credits_balance', balance.toString());
            localStorage.setItem('credits_transactions', JSON.stringify(transactions));
        }
    }, [balance, transactions, isInitialized]);

    const addCredits = useCallback((amount: number, description?: string) => {
        const transaction: CreditTransaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount,
            type: 'deposit',
            description: description || 'Added credits via HCB',
            timestamp: new Date(),
        };

        setBalance(prev => prev + amount);
        setTransactions(prev => [transaction, ...prev]);
    }, []);

    const useCredits = useCallback((amount: number, orderId?: string): boolean => {
        if (amount > balance) {
            return false;
        }

        const transaction: CreditTransaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            amount: -amount,
            type: 'purchase',
            description: 'Purchase at Hack Club Shop',
            timestamp: new Date(),
            orderId,
        };

        setBalance(prev => prev - amount);
        setTransactions(prev => [transaction, ...prev]);
        return true;
    }, [balance]);

    const canAfford = useCallback((amount: number): boolean => {
        return balance >= amount;
    }, [balance]);

    if (!isInitialized) {
        return null;
    }

    return (
        <CreditsContext.Provider value={{ balance, transactions, addCredits, useCredits, canAfford }}>
            {children}
        </CreditsContext.Provider>
    );
};
