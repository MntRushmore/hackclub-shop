export interface PointsTransaction {
    id: string;
    amount: number;
    type: 'earn' | 'spend' | 'refund';
    description: string;
    timestamp: Date;
    orderId?: string;
}

export interface PointsState {
    balance: number;
    transactions: PointsTransaction[];
}

export interface PointsContextType {
    balance: number;
    transactions: PointsTransaction[];
    earnPoints: (amount: number, description?: string) => void | Promise<void>;
    spendPoints: (amount: number, orderId?: string) => boolean | Promise<boolean>;
    canAfford: (amount: number) => boolean;
    refreshPoints: () => Promise<void>;
    isLoading?: boolean;
}
