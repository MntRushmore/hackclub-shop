export interface CreditTransaction {
    id: string;
    amount: number;
    type: 'deposit' | 'purchase' | 'refund';
    description: string;
    timestamp: Date;
    orderId?: string;
}

export interface CreditsState {
    balance: number;
    transactions: CreditTransaction[];
}

export interface CreditsContextType {
    balance: number;
    transactions: CreditTransaction[];
    addCredits: (amount: number, description?: string) => void | Promise<void>;
    useCredits: (amount: number, orderId?: string) => boolean | Promise<boolean>;
    canAfford: (amount: number) => boolean;
    refreshCredits: () => Promise<void>;
    isLoading?: boolean;
}
