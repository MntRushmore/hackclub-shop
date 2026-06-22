'use client';

import React, { useState, useEffect, useContext } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { CartContext } from '../../context/CartContext';
import { getCashPrice, getPointsPrice, getDisplayPrice } from '../../lib/paymentUtils';
import { usePathway } from '../../lib/usePathway';

interface Variant {
    variant_id: string | number;
    name: string;
    id?: string | number;
    size?: string;
    color?: string;
    retail_price: string;
    price_cash?: number;
    price_points?: number;
    product: { image: string };
}

interface Product {
    id: string | number;
    name: string;
    thumbnail_url: string;
    sync_variants: Variant[];
}

const Shop = () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [draggingProduct, setDraggingProduct] = useState<Product | null>(null);
    const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isReleasing, setIsReleasing] = useState(false);
    const [releaseOnCart, setReleaseOnCart] = useState(false);
    const cartContext = useContext(CartContext);
    const { pathway } = usePathway();

    useEffect(() => {
        const fetchProducts = async () => {
            try {
                const response = await fetch('/api/products');
                if (!response.ok) {
                    throw new Error('Failed to fetch products');
                }
                const data = await response.json();
                setProducts(data.result);
            } catch (error: any) {
                console.error(error);
                setError(error.message);
            } finally {
                setLoading(false);
            }
        };

        fetchProducts();
    }, []);

    const handleDragStart = (e: React.MouseEvent, product: Product) => {
        const startX = e.clientX;
        const startY = e.clientY;
        let hasMoved = false;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = Math.abs(moveEvent.clientX - startX);
            const deltaY = Math.abs(moveEvent.clientY - startY);
            
            if (!hasMoved && (deltaX > 5 || deltaY > 5)) {
                hasMoved = true;
                setDraggingProduct(product);
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'grabbing';
            }
            
            if (hasMoved) {
                setDragPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
            }
        };

        const handleMouseUp = (upEvent: MouseEvent) => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            
            if (!hasMoved) {
                window.location.href = `/products/${product.id}`;
                return;
            }
            
            const cartButton = document.querySelector('[data-cart-button]');
            let droppedOnCart = false;
            
            if (cartButton) {
                const rect = cartButton.getBoundingClientRect();
                const isNearCart = 
                    upEvent.clientX >= rect.left - 100 &&
                    upEvent.clientX <= rect.right + 100 &&
                    upEvent.clientY >= rect.top - 100 &&
                    upEvent.clientY <= rect.bottom + 100;

                if (isNearCart && product.sync_variants && product.sync_variants.length > 0 && cartContext) {
                    droppedOnCart = true;
                    const variant = product.sync_variants[0];

                    const variantId = variant.variant_id || variant.id || `${product.id}_var_0`;
                    cartContext.addToCart({
                        id: product.id,
                        name: variant.name,
                        price: String(getCashPrice(variant)),
                        price_cash: getCashPrice(variant) || undefined,
                        price_points: getPointsPrice(variant) || undefined,
                        thumbnail_url: variant.product.image,
                        variant_id: variantId,
                    });
                }
            }

            setIsReleasing(true);
            setReleaseOnCart(droppedOnCart);
            
            setTimeout(() => {
                setDraggingProduct(null);
                setIsReleasing(false);
                setReleaseOnCart(false);
            }, droppedOnCart ? 300 : 150);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: loading ? 0 : 1 }}
            transition={{ duration: 0.3 }}
            className="min-h-screen bg-white" 
            style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="mb-12">
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-4">
                        Browse Merch
                    </h1>
                    <p className="text-xl text-hackclub-slate font-bold">
                        Stickers, shirts, and more cool stuff
                    </p>
                </div>
                
                {error && (
                    <div className="text-center py-20">
                        <p className="text-hackclub-red text-lg font-bold">⚠️ {error}</p>
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {products.map((product) => (
                        <motion.div
                            key={product.id}
                            whileHover={{ scale: 1.02 }}
                            className="group bg-white rounded-2xl shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden border-2 border-gray-200 hover:border-hackclub-red relative"
                        >
                            <div 
                                className="aspect-square bg-hackclub-smoke relative overflow-hidden"
                                style={{ cursor: draggingProduct?.id === product.id ? 'grabbing' : 'pointer' }}
                                onMouseDown={(e) => {
                                    handleDragStart(e, product);
                                }}
                                onDragStart={(e) => e.preventDefault()}
                            >
                                <Image
                                    src={product.thumbnail_url}
                                    alt={product.name}
                                    fill
                                    className="object-contain p-6 group-hover:scale-105 transition-transform duration-300 pointer-events-none"
                                    draggable={false}
                                />
                            </div>
                            <div className="flex flex-col gap-2 p-5 bg-white">
                                <Link href={`/products/${product.id}`} className="block">
                                    <h2 className="text-lg font-black text-hackclub-dark mb-2 line-clamp-2 group-hover:text-hackclub-red transition-colors">
                                         {product.name}
                                     </h2>
                                     <div className="mb-3">
                                         {getDisplayPrice(product.sync_variants[0], pathway) ? (
                                             <p className="text-lg font-black text-hackclub-red">
                                                 {getDisplayPrice(product.sync_variants[0], pathway)}
                                             </p>
                                         ) : (
                                             <p className="text-sm text-gray-400 font-medium">Not available</p>
                                         )}
                                     </div>
                                </Link>
                                <div className="flex items-center gap-2">
                                    <Link href={`/products/${product.id}`} className="text-hackclub-blue font-bold text-sm flex items-center gap-1">
                                        View Details
                                        <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </Link>
                                    <button
                                        className="bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-4 py-1 rounded-full shadow transition-colors transition-opacity duration-200 text-sm opacity-0 group-hover:opacity-100 focus:opacity-100 ml-auto"
                                        onClick={(e) => {
                                             e.stopPropagation();
                                             e.preventDefault();
                                             if (product.sync_variants && product.sync_variants.length > 0 && cartContext) {
                                                  const variant = product.sync_variants[0];

                                                  const variantId = variant.variant_id || variant.id || `${product.id}_var_0`;
                                                   cartContext.addToCart({
                                                       id: product.id,
                                                       name: variant.name,
                                                       price: String(getCashPrice(variant)),
                                                       price_cash: getCashPrice(variant) || undefined,
                                                       price_points: getPointsPrice(variant) || undefined,
                                                       thumbnail_url: variant.product.image,
                                                       variant_id: variantId,
                                                   });
                                             }
                                             e.currentTarget.blur();
                                         }}
                                    >
                                        Add to Cart
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {draggingProduct && (
                    <motion.div
                        className="fixed pointer-events-none z-[10003]"
                        style={{
                            left: dragPosition.x - 90,
                            top: dragPosition.y - 90,
                        }}
                        initial={{ scale: 0.8, opacity: 0.5 }}
                        animate={{ 
                            scale: isReleasing ? (releaseOnCart ? 0.1 : 1.5) : 1,
                            opacity: isReleasing ? 0 : 1,
                        }}
                        transition={{ 
                            scale: { duration: isReleasing ? (releaseOnCart ? 0.3 : 0.15) : 0.1, ease: 'easeOut' },
                            opacity: { duration: isReleasing ? (releaseOnCart ? 0.3 : 0.15) : 0.1 }
                        }}
                    >
                        <div className="w-60 h-60 bg-white rounded-xl shadow-2xl border-4 border-hackclub-red overflow-hidden transform scale-[0.3] rotate-[5deg]">
                            <Image
                                src={draggingProduct.thumbnail_url}
                                alt={draggingProduct.name}
                                width={240}
                                height={240}
                                className="object-contain p-4"
                            />
                        </div>
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
};

export default Shop;
