'use client';

import React, { createContext, useState, useEffect } from 'react';

interface CartItem {
    id: number;
    name: string;
    price: string;
    thumbnail_url: string;
    variant_id: number | null;
    quantity: number;
}

interface CartContextType {
    cart: CartItem[] | null;
    addToCart: (item: Omit<CartItem, 'id' | 'quantity'>) => void;
    removeFromCart: (id: number) => void;
    updateQuantity: (id: number, quantity: number) => void;
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

    const addToCart = (item: Omit<CartItem, 'id' | 'quantity'>) => {
        setCart((prevCart) => {
            if (!prevCart) return [{ id: Date.now(), ...item, quantity: 1 }];
            
            const existingItemIndex = prevCart.findIndex(
                (cartItem) => cartItem.variant_id === item.variant_id && cartItem.variant_id !== null
            );
            
            if (existingItemIndex !== -1) {
                const updatedCart = [...prevCart];
                updatedCart[existingItemIndex] = {
                    ...updatedCart[existingItemIndex],
                    quantity: updatedCart[existingItemIndex].quantity + 1
                };
                return updatedCart;
            } else {
                const uniqueId = Date.now() + Math.floor(Math.random() * 1000);
                return [...prevCart, { id: uniqueId, ...item, quantity: 1 }];
            }
        });
    };

    const removeFromCart = (id: number) => {
        setCart((prevCart) => prevCart ? prevCart.filter((item) => item.id !== id) : []);
    };

    const updateQuantity = (id: number, quantity: number) => {
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