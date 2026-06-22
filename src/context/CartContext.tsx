'use client';

import React, { createContext, useState, useEffect } from 'react';

interface CartItem {
    id: string | number;
    name: string;
    price: string;            // keep for display compatibility (USD string)
    price_cash?: number;      // USD, for adult/Stripe path
    price_points?: number;    // points, for student path
    thumbnail_url: string;
    variant_id?: string | number | null;
    quantity: number;
}

interface CartContextType {
    cart: CartItem[] | null;
    addToCart: (item: Omit<CartItem, 'quantity'>) => void;
    removeFromCart: (id: string | number) => void;
    updateQuantity: (id: string | number, quantity: number) => void;
    clearCart: () => void;
    totalPrice: number;
}

export const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [cart, setCart] = useState<CartItem[] | null>(null);

    useEffect(() => {
        const savedCart = JSON.parse(localStorage.getItem('cart') || '[]') as CartItem[];
        setCart(savedCart);
    }, []);

    useEffect(() => {
        if (cart !== null) {
            localStorage.setItem('cart', JSON.stringify(cart));
        }
    }, [cart]);

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

    const clearCart = () => {
        setCart([]);
    };

    const totalPrice = cart ? cart.reduce((total, item) => total + (parseFloat(item.price) * item.quantity), 0) : 0;

    if (cart === null) {
        return null;
    }

    return (
        <CartContext.Provider value={{ cart, addToCart, removeFromCart, updateQuantity, clearCart, totalPrice }}>
            {children}
        </CartContext.Provider>
    );
};
