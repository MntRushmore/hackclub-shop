'use client';

import { motion } from 'framer-motion';

interface SkeletonProps {
    className?: string;
}

export const Skeleton = ({ className = '' }: SkeletonProps) => (
    <motion.div
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className={`bg-hackclub-smoke rounded ${className}`}
    />
);

export const CardSkeleton = () => (
    <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke p-6">
        <Skeleton className="h-40 w-full rounded-xl mb-4" />
        <Skeleton className="h-6 w-3/4 mb-2" />
        <Skeleton className="h-4 w-1/2 mb-4" />
        <Skeleton className="h-10 w-full rounded-full" />
    </div>
);

export const OrderSkeleton = () => (
    <div className="bg-white rounded-2xl shadow-lg border-2 border-hackclub-smoke overflow-hidden">
        <div className="px-6 py-4 border-b-2 border-hackclub-smoke flex items-center justify-between">
            <div>
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="px-6 py-4 space-y-3">
            {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4">
                    <Skeleton className="w-12 h-12 rounded-lg" />
                    <div className="flex-1">
                        <Skeleton className="h-4 w-32 mb-1" />
                        <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-5 w-16" />
                </div>
            ))}
        </div>
        <div className="px-6 py-4 border-t-2 border-hackclub-smoke bg-hackclub-smoke/30 flex items-center justify-between">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-6 w-20" />
        </div>
    </div>
);

export const CreditsSkeleton = () => (
    <div className="bg-white rounded-2xl p-6 shadow-lg border-2 border-hackclub-smoke">
        <div className="flex items-center justify-between">
            <div>
                <Skeleton className="h-4 w-28 mb-2" />
                <Skeleton className="h-12 w-32" />
            </div>
            <Skeleton className="h-12 w-32 rounded-full" />
        </div>
    </div>
);

export const PageSkeleton = () => (
    <div className="max-w-2xl mx-auto px-4 py-12">
        <Skeleton className="h-12 w-48 mb-2" />
        <Skeleton className="h-6 w-64 mb-10" />
        <CreditsSkeleton />
    </div>
);
