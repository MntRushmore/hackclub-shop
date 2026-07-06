'use client';

import React, { createContext, useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

interface CartItem {
    id: string | number;
    name: string;
    price: string;            // keep for display compatibility (USD string)
    price_cash?: number;      // USD, for adult/Stripe path
    price_points?: number;    // points, for student path
    thumbnail_url: string;
    variant_id?: string | number | null;
    quantity: number;
    // Donation tiers: true = the donor chose monthly giving (checkout builds a
    // subscription instead of a one-time payment). Set on the tier page,
    // adjustable at checkout.
    recurring?: boolean;
}

interface CartContextType {
    cart: CartItem[] | null;
    addToCart: (item: Omit<CartItem, 'quantity'>) => void;
    removeFromCart: (id: string | number) => void;
    updateQuantity: (id: string | number, quantity: number) => void;
    // Swap which variant a cart line points at (donation tiers: the thank-you
    // gift/size is chosen at checkout, after the tier is already in the cart).
    updateItemVariant: (id: string | number, variant_id: string | number, patch?: { name?: string; thumbnail_url?: string }) => void;
    clearCart: () => void;
    totalPrice: number;
}

export const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [cart, setCart] = useState<CartItem[] | null>(null);
    const { data: session, status } = useSession();
    const userId = session?.user?.id;
    // Tracks which user's server cart we've already merged in, so the one-time
    // login merge doesn't re-run on every render or overwrite later edits.
    const mergedForUser = useRef<string | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const savedCart = JSON.parse(localStorage.getItem('cart') || '[]') as CartItem[];
        setCart(savedCart);
    }, []);

    // localStorage stays the always-on store (and the only store for guests).
    useEffect(() => {
        if (cart !== null) {
            localStorage.setItem('cart', JSON.stringify(cart));
        }
    }, [cart]);

    // On login, reconcile with the student's server-side cart so it follows them
    // across devices: a non-empty server cart wins (cross-device continuity); an
    // empty server cart adopts whatever the guest had locally (carry-over).
    useEffect(() => {
        if (status !== 'authenticated' || !userId) {
            if (status === 'unauthenticated') mergedForUser.current = null;
            return;
        }
        if (mergedForUser.current === userId || cart === null) return;
        mergedForUser.current = userId;

        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/cart');
                const data = await res.json();
                if (cancelled) return;
                const serverCart = Array.isArray(data.cart) ? (data.cart as CartItem[]) : null;
                if (serverCart && serverCart.length > 0) {
                    setCart(serverCart);
                } else if (cart.length > 0) {
                    // Push the local cart up so this device's items persist server-side.
                    void fetch('/api/cart', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cart }),
                    });
                }
            } catch {
                // Network/Redis hiccup — localStorage cart remains intact.
            }
        })();
        return () => { cancelled = true; };
    }, [status, userId, cart]);

    // Debounced push of cart changes to the server for logged-in students. This
    // also propagates clearCart() (an empty array) — keeping the clear-on-success
    // behaviour identical across devices.
    useEffect(() => {
        if (status !== 'authenticated' || !userId || cart === null) return;
        if (mergedForUser.current !== userId) return; // wait until the initial merge ran
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            void fetch('/api/cart', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cart }),
            });
        }, 600);
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    }, [cart, status, userId]);

    const addToCart = (item: Omit<CartItem, 'quantity'>) => {
        setCart((prevCart) => {
            const itemWithId = {
                ...item,
                id: item.id !== undefined ? item.id : `${Date.now()}_${Math.floor(Math.random() * 1000)}`
            };
            if (!prevCart) return [{ ...itemWithId, quantity: 1 }];
            
            // Check for existing item by variant (if variant exists) or by product ID
            const existingItemIndex = prevCart.findIndex(
                (cartItem) => {
                    if (item.variant_id && cartItem.variant_id) {
                        return cartItem.id === item.id && cartItem.variant_id === item.variant_id;
                    }
                    return cartItem.id === item.id;
                }
            );
            
            if (existingItemIndex !== -1) {
                const updatedCart = [...prevCart];
                updatedCart[existingItemIndex] = {
                    ...updatedCart[existingItemIndex],
                    quantity: updatedCart[existingItemIndex].quantity + 1
                };
                return updatedCart;
            } else {
                return [...prevCart, { ...itemWithId, quantity: 1 }];
            }
        });
    };

    const removeFromCart = (id: string | number) => {
        setCart((prevCart) => prevCart ? prevCart.filter((item) => item.id !== id) : []);
    };

    const updateQuantity = (id: string | number, quantity: number) => {
        if (quantity <= 0) {
            removeFromCart(id);
            return;
        }
        setCart((prevCart) => {
            if (!prevCart) return [];
            return prevCart.map((item) => 
                item.id === id ? { ...item, quantity } : item
            );
        });
    };

    const updateItemVariant = (id: string | number, variant_id: string | number, patch?: { name?: string; thumbnail_url?: string }) => {
        setCart((prevCart) => {
            if (!prevCart) return [];
            return prevCart.map((item) =>
                item.id === id ? { ...item, variant_id, ...(patch || {}) } : item,
            );
        });
    };

    const clearCart = () => {
        setCart([]);
    };

    const totalPrice = cart ? cart.reduce((total, item) => total + (parseFloat(item.price) * item.quantity), 0) : 0;

    if (cart === null) {
        return null;
    }

    return (
        <CartContext.Provider value={{ cart, addToCart, removeFromCart, updateQuantity, updateItemVariant, clearCart, totalPrice }}>
            {children}
        </CartContext.Provider>
    );
};
