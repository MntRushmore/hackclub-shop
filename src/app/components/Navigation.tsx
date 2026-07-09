'use client';

import React, { useContext, useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { CartContext } from '../../context/CartContext';
import Image from 'next/image';
import CartModal from './CartModal';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, signIn, signOut } from 'next-auth/react';
import { usePathway } from '../../lib/usePathway';
import Lottie from 'lottie-react';
import animationData from '../../../public/images/shopping-bag.json';
import type { LottieRefCurrentProps } from 'lottie-react';

const ShoppingBagIcon = forwardRef<{ closeAndWait: () => Promise<void> }, unknown>((props, ref) => {
  const lottieRef = useRef<LottieRefCurrentProps>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isInitialMount = useRef(true);

  useImperativeHandle(ref, () => ({
    closeAndWait: async () => {
      setIsHovered(false);
      // Wait for close animation to finish
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }));

  useEffect(() => {
    if (!lottieRef.current) return;
    if (isInitialMount.current) return;
    
    if (isHovered) {
      lottieRef.current.playSegments([0, 40], true);
    } else {
      lottieRef.current.playSegments([67, 127], true);
    }
  }, [isHovered]);

  useEffect(() => {
    if (!lottieRef.current) return;
    lottieRef.current.goToAndStop(67, true);
    isInitialMount.current = false;
  }, []);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ width: 56, height: 56, cursor: 'pointer' }}
    >
      <Lottie
        lottieRef={lottieRef}
        animationData={animationData}
        loop={false}
        autoplay={false}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
});
ShoppingBagIcon.displayName = 'ShoppingBagIcon';

const Navigation = () => {
  const router = useRouter();
  const pathname = usePathname();
  const bagIconRef = useRef<{ closeAndWait: () => Promise<void> }>(null);
  const cartContext = useContext(CartContext);
  const { data: session, status } = useSession();
  const { isAdminMode } = usePathway();
  const [isClient, setIsClient] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [, setPrevPrice] = useState(0);
  const [prevItemCount, setPrevItemCount] = useState(0);
  const [shouldAnimateCart, setShouldAnimateCart] = useState(false);
  const [isInitialMount, setIsInitialMount] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Resolve admin status for the current user (drives the Admin nav link + badge).
  useEffect(() => {
    if (status !== 'authenticated') {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    fetch('/api/admin/me')
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setIsAdmin(Boolean(data?.isAdmin)); })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, [status]);

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
  }, [cartContext, isClient, isInitialMount, prevItemCount]);

  // The launch-lock page is a standalone full-screen surface — no store chrome.
  if (pathname === '/launch') {
    return null;
  }

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
              <button
                className="flex items-center bg-none border-none p-0 cursor-pointer"
                onClick={async () => {
                  await bagIconRef.current?.closeAndWait();
                  router.push('/');
                }}
              >
                <ShoppingBagIcon ref={bagIconRef} />
              </button>

              <Link
                href="/shop"
                className="text-hackclub-slate hover:text-hackclub-red font-bold text-xl transition-colors"
              >
                Browse
              </Link>

              <Link
                href="/donors"
                className="text-hackclub-slate hover:text-hackclub-red font-bold text-xl transition-colors"
              >
                Donors
              </Link>

              {session && isAdmin && (
                <Link
                  href="/submit"
                  className="text-hackclub-red hover:text-hackclub-orange font-bold text-xl transition-colors"
                >
                  Submit
                </Link>
              )}

              {session && (
                <Link
                  href="/orders"
                  className="text-hackclub-slate hover:text-hackclub-red font-bold text-xl transition-colors"
                >
                  Orders
                </Link>
              )}

              {session && isAdmin && (
                <Link
                  href="/admin"
                  className="text-hackclub-red hover:text-hackclub-orange font-bold text-xl transition-colors flex items-center gap-1.5"
                >
                  Admin
                </Link>
              )}
            </div>

            <div className="flex items-center gap-4">
              {status === 'loading' ? (
                <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
              ) : session ? (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                  >
                    {session.user?.image ? (
                      <Image
                        src={session.user.image}
                        alt={session.user.name || 'User'}
                        width={32}
                        height={32}
                        className="rounded-full border-2 border-hackclub-red"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-hackclub-red flex items-center justify-center text-white font-bold text-sm">
                        {session.user?.name?.charAt(0) || '?'}
                      </div>
                    )}
                    <span className="hidden sm:inline text-hackclub-slate font-bold">
                      {session.user?.name?.split(' ')[0]}
                    </span>
                  </button>

                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-hackclub-dark truncate">{session.user?.name}</p>
                          {isAdmin && (
                            <span className="text-[10px] font-black uppercase tracking-wide bg-hackclub-red/10 text-hackclub-red px-1.5 py-0.5 rounded">
                              Admin
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-hackclub-slate truncate">{session.user?.email}</p>
                      </div>
                      {isAdmin && (
                        <Link
                          href="/admin"
                          onClick={() => setShowUserMenu(false)}
                          className="block px-4 py-2 text-hackclub-dark hover:bg-gray-50 font-bold transition-colors"
                        >
                          Admin Dashboard
                        </Link>
                      )}
                      <button
                        onClick={() => signOut()}
                        className="w-full text-left px-4 py-2 text-hackclub-red hover:bg-gray-50 font-bold transition-colors"
                      >
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => signIn('hackclub')}
                  className="flex items-center gap-2 text-hackclub-slate hover:text-hackclub-red font-bold transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span className="hidden sm:inline">Sign In</span>
                </button>
              )}

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
              {/* Admin full-catalog mode can hold points-priced items whose cart
                  "price" is a points count, so a $ total would be wrong there.
                  Public shoppers are all-cash and get the real dollar total. */}
              {!isAdminMode && (
                <span className="hidden md:inline">· $<AnimatedPrice value={totalPrice} shouldAnimate={shouldAnimateCart} /></span>
              )}
            </motion.button>
            </div>
          </div>
        </div>
      </nav>

      <CartModal isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
};

export default Navigation;