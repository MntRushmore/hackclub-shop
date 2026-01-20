'use client';

import React, { useContext } from 'react';
import { CartContext } from '../../context/CartContext';
import { useRouter } from 'next/navigation';

const CartPage = () => {
    const cartContext = useContext(CartContext);
    const router = useRouter();

    if (!cartContext || cartContext.cart === null) {
        return null;
    }

    const { cart, removeFromCart, clearCart, totalPrice } = cartContext;

    const handleCheckout = () => {
        router.push('/checkout');
    };

    return (
        <div className="bg-hackclub-dark min-h-screen">
            <div className="container mx-auto p-6">
                <h1 className="text-3xl font-bold mb-6">Your Cart</h1>
                {cart.length > 0 ? (
                    <>
                        <ul>
                            {cart.map((item) => (
                                <li key={item.id} className="flex justify-between items-center py-2">
                                    <div>
                                        <p className="font-semibold">{item.name}</p>
                                        <p>${parseFloat(item.price).toFixed(2)}</p>
                                    </div>
                                    <button
                                        className="text-white bg-red-600 rounded"
                                        onClick={() => removeFromCart(item.id)}
                                    >
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <div className="flex justify-between mt-4 font-semibold">
                            <span>Total:</span>
                            <span>${totalPrice.toFixed(2)}</span>
                        </div>
                        <button
                            className="bg-blue-600 text-white py-2 px-4 mt-6 rounded"
                            onClick={handleCheckout}
                        >
                            Proceed to Preorder Checkout
                        </button>
                        <button
                            className="bg-red-600 text-white py-2 px-4 mt-6 rounded ml-4"
                            onClick={clearCart}
                        >
                            Clear Cart
                        </button>
                    </>
                ) : (
                    <p>Your cart is empty.</p>
                )}
            </div>
        </div>
    );
};

export default CartPage;