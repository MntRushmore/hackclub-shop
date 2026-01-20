'use client';

import React, { useContext, useState, useEffect } from 'react';
import Link from 'next/link';
import { CartContext } from '../../context/CartContext';
import Image from 'next/image';
import CartModal from './CartModal';
import { motion, AnimatePresence } from 'framer-motion';

const Navigation = () => {
  const cartContext = useContext(CartContext);
  const [isClient, setIsClient] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [prevPrice, setPrevPrice] = useState(0);
  const [prevItemCount, setPrevItemCount] = useState(0);
  const [shouldAnimateCart, setShouldAnimateCart] = useState(false);
  const [isInitialMount, setIsInitialMount] = useState(true);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (cartContext?.totalPrice !== undefined) {
      setPrevPrice(cartContext.totalPrice);
    }
  }, [cartContext?.totalPrice]);

  useEffect(() => {
    if (isClient && cartContext && cartContext.cart) {
      const currentCount = cartContext.cart.reduce((total, item) => total + item.quantity, 0);
      if (isInitialMount) {
        setPrevItemCount(currentCount);
        setIsInitialMount(false);
      } else if (currentCount > prevItemCount) {
        setShouldAnimateCart(true);
        setTimeout(() => setShouldAnimateCart(false), 300);
        setPrevItemCount(currentCount);
      } else if (currentCount !== prevItemCount) {
        setPrevItemCount(currentCount);
      }
    }
  }, [cartContext?.cart, isClient, isInitialMount, prevItemCount]);

  if (!cartContext || cartContext.cart === null) {
    return null;
  }

  const { cart, totalPrice } = cartContext;

  if (!isClient) {
    return null;
  }

  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);

  const AnimatedPrice = ({ value, shouldAnimate }: { value: number; shouldAnimate: boolean }) => {
    const priceStr = value.toFixed(2);
    const chars = priceStr.split('');
    
    return (
      <span className="inline-flex">
        {chars.map((char, i) => (
          <motion.span
            key={`${char}-${i}-${value}`}
            initial={shouldAnimate ? { y: -20, opacity: 0 } : false}
            animate={{ y: 0, opacity: 1 }}
            transition={shouldAnimate ? { delay: i * 0.02, duration: 0.2 } : { duration: 0 }}
            className="inline-block"
          >
            {char}
          </motion.span>
        ))}
      </span>
    );
  };

  return (
    <>
      <nav className="sticky top-0 z-[10000] bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <a href="https://hackclub.com" target="_blank" rel="noopener noreferrer" className="flex items-center hover:opacity-80 transition-opacity">
                <Image
                  src="https://assets.hackclub.com/flag-standalone.svg"
                  alt="Hack Club"
                  width={40}
                  height={40}
                  className="h-8 w-auto"
                />
              </a>
              
              <Link 
                href="/" 
                className="text-hackclub-slate hover:text-hackclub-red font-bold text-xl transition-colors"
              >
                Home
              </Link>

              <Link 
                href="/shop" 
                className="text-hackclub-slate hover:text-hackclub-red font-bold text-xl transition-colors"
              >
                Browse
              </Link>
            </div>

            <motion.button
              data-cart-button
              onClick={() => setIsCartOpen(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              animate={shouldAnimateCart ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-2 bg-hackclub-red hover:bg-hackclub-orange text-white px-4 py-2 rounded-full font-bold transition-all shadow-md hover:shadow-lg"
            >
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                className="h-5 w-5" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" 
                />
              </svg>
              {shouldAnimateCart ? (
                <AnimatePresence mode="wait">
                  <motion.span 
                    key={itemCount}
                    initial={{ y: -10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 10, opacity: 0 }}
                    className="hidden sm:inline"
                  >
                    {itemCount}
                  </motion.span>
                </AnimatePresence>
              ) : (
                <span className="hidden sm:inline">{itemCount}</span>
              )}
              <span className="hidden md:inline">· $<AnimatedPrice value={totalPrice} shouldAnimate={shouldAnimateCart} /></span>
            </motion.button>
          </div>
        </div>
      </nav>

      <CartModal isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
};

export default Navigation;