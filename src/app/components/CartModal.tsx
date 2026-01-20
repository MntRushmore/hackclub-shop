'use client';

import React, { useContext } from 'react';
import { CartContext } from '../../context/CartContext';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';

interface CartModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CartModal: React.FC<CartModalProps> = ({ isOpen, onClose }) => {
  const cartContext = useContext(CartContext);
  const router = useRouter();

  if (!cartContext || cartContext.cart === null) {
    return null;
  }

  const { cart, removeFromCart, updateQuantity, clearCart, totalPrice } = cartContext;

  const handleCheckout = () => {
    onClose();
    router.push('/checkout');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[10001]"
            onClick={onClose}
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-[calc(100vh-2rem)] my-4 w-full sm:w-[500px] bg-white rounded-l-2xl shadow-2xl z-[10002] flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-white rounded-tl-2xl">
              <h2 className="text-2xl font-black text-hackclub-dark">Your Cart</h2>
              <button
                onClick={onClose}
                className="text-hackclub-slate hover:text-hackclub-dark transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <AnimatePresence initial={false}>
                {cart.length > 0 ? (
                  cart.map((item) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8, x: 100 }}
                      transition={{ duration: 0.2 }}
                      className="bg-white rounded-xl p-4 shadow-sm border border-gray-200 hover:shadow-md transition-shadow mb-4"
                    >
                      <div className="flex gap-4">
                        {item.thumbnail_url && (
                          <Image
                            src={item.thumbnail_url}
                            alt={item.name}
                            width={80}
                            height={80}
                            className="rounded-lg object-cover bg-hackclub-smoke"
                          />
                        )}
                        <div className="flex-1">
                          <h3 className="font-bold text-hackclub-dark mb-1">{item.name}</h3>
                          <p className="text-lg font-black text-hackclub-red">
                            ${parseFloat(item.price).toFixed(2)}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              className="w-6 h-6 rounded-full bg-hackclub-smoke hover:bg-hackclub-muted text-hackclub-dark font-bold flex items-center justify-center"
                            >
                              −
                            </motion.button>
                            <span className="font-bold text-hackclub-dark min-w-[20px] text-center">{item.quantity}</span>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              className="w-6 h-6 rounded-full bg-hackclub-smoke hover:bg-hackclub-muted text-hackclub-dark font-bold flex items-center justify-center"
                            >
                              +
                            </motion.button>
                          </div>
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          className="text-hackclub-red hover:text-hackclub-orange transition-colors self-start"
                          onClick={() => removeFromCart(item.id)}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </motion.button>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center py-12"
                  >
                    <svg className="w-16 h-16 mx-auto text-hackclub-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <p className="text-hackclub-muted font-bold">Your cart is empty</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {cart.length > 0 && (
              <div className="p-6 border-t border-gray-200 bg-white rounded-bl-2xl space-y-4">
                <div className="flex justify-between items-center text-xl font-black">
                  <span className="text-hackclub-dark">Total:</span>
                  <span className="text-hackclub-red">${totalPrice.toFixed(2)}</span>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black text-lg py-3 rounded-full transition-all shadow-lg hover:shadow-xl"
                  onClick={handleCheckout}
                >
                  Checkout →
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full text-hackclub-red hover:text-hackclub-orange font-bold py-2 transition-colors"
                  onClick={clearCart}
                >
                  Clear Cart
                </motion.button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CartModal;
