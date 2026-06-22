'use client';

import React, { useEffect, useState, useContext } from "react";
import { useParams } from "next/navigation";
import { CartContext } from "../../../context/CartContext";
import Image from 'next/image';
import { ProductDetail, Variant } from '../../../types/Product';
import { motion } from 'framer-motion';
import { getCashPrice, getPointsPrice, getDisplayPrice, isAvailableOn } from '../../../lib/paymentUtils';
import { usePathway } from '../../../lib/usePathway';


const ProductPage = () => {
    const params = useParams();
    const productId = params.id;

    const { addToCart } = useContext(CartContext)!;
    const { pathway, isGuest } = usePathway();

    const [product, setProduct] = useState<ProductDetail | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
    const [variants, setVariants] = useState<Variant[]>([]);

    useEffect(() => {
        const fetchProduct = async () => {
            try {
                const response = await fetch(`/api/products/${productId}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch product');
                }
                const data = await response.json();
                setProduct(data.result.sync_product);
                setVariants(data.result.sync_variants);

                if (data.result.sync_variants && data.result.sync_variants.length > 0) {
                    setSelectedVariant(data.result.sync_variants[0]);
                }
            } catch (error: any) {
                console.error(error);
                setError(error.message);
            } finally {
                setLoading(false);
            }
        };

        fetchProduct();
    }, [productId]);

    const handleAddToCart = () => {
        if (product && selectedVariant && isAvailableOn(selectedVariant, pathway)) {
            const cartItem = {
                id: product.id,
                name: selectedVariant.name,
                price: String(getCashPrice(selectedVariant)),
                price_cash: getCashPrice(selectedVariant) || undefined,
                price_points: getPointsPrice(selectedVariant) || undefined,
                thumbnail_url: selectedVariant.product.image,
                variant_id: selectedVariant.variant_id || selectedVariant.id,
            };

            addToCart(cartItem);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white" style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
                    <div className="text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-hackclub-red"></div>
                        <p className="mt-4 text-hackclub-muted font-bold">Loading product...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !product) {
        return (
            <div className="min-h-screen bg-white" style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
                    <p className="text-center text-hackclub-red text-xl font-bold">{error || 'Product not found'}</p>
                </div>
            </div>
        );
    }

    // Strict path separation: a variant is buyable only if it's priced for the
    // active pathway, and the product is only purchasable at all if at least one
    // variant is.
    const selectedAvailable = !!selectedVariant && isAvailableOn(selectedVariant, pathway);
    const anyVariantAvailable = variants.some((variant) => isAvailableOn(variant, pathway));

    return (
        <div
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
                <div className="grid md:grid-cols-2 gap-12 items-start">
                    <div className="bg-white rounded-2xl p-8 shadow-lg border-2 border-gray-200">
                        <Image
                            src={selectedVariant?.product.image || product.thumbnail_url}
                            alt={product.name}
                            width={600}
                            height={600}
                            className="w-full h-auto object-contain"
                        />
                    </div>

                    <div className="bg-white rounded-2xl p-8 shadow-lg border-2 border-gray-200">
                        <h1 className="text-4xl sm:text-5xl font-black text-hackclub-dark mb-4">
                            {product.name}
                        </h1>
                        
                        {selectedVariant && (
                            <div className="mb-8">
                                {getDisplayPrice(selectedVariant, pathway) ? (
                                    <p className="text-3xl font-black text-hackclub-red">
                                        {getDisplayPrice(selectedVariant, pathway)}
                                    </p>
                                ) : (
                                    <p className="text-lg text-gray-400 font-medium">Not available</p>
                                )}
                            </div>
                        )}

                        {variants.length > 0 && (
                            <div className="mb-8">
                                <label htmlFor="variant" className="block text-lg font-bold text-hackclub-dark mb-3">
                                    Select Variant:
                                </label>
                                <select
                                    id="variant"
                                    value={selectedVariant?.id || selectedVariant?.variant_id || ''}
                                    onChange={(e) => {
                                        const variant = variants.find(v =>
                                            String(v.id) === e.target.value || String(v.variant_id) === e.target.value
                                        );
                                        if (variant) {
                                            setSelectedVariant(variant);
                                        }
                                    }}
                                    className="border-2 border-gray-300 rounded-xl p-3 w-full bg-white text-hackclub-dark font-bold focus:outline-none focus:border-hackclub-red transition-colors"
                                >
                                    {variants.map((variant, idx) => (
                                        <option key={`${variant.id || variant.variant_id}_${idx}`} value={variant.id || variant.variant_id}>
                                            {variant.size || 'Default'} / {variant.color || 'Default'}
                                            {getDisplayPrice(variant, pathway) ? ` - ${getDisplayPrice(variant, pathway)}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {anyVariantAvailable ? (
                            <motion.button
                                whileHover={selectedAvailable ? { scale: 1.05 } : undefined}
                                whileTap={selectedAvailable ? { scale: 0.95 } : undefined}
                                disabled={!selectedAvailable}
                                className={
                                    selectedAvailable
                                        ? "w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black text-lg py-4 rounded-full transition-all shadow-lg hover:shadow-xl"
                                        : "w-full bg-gray-200 text-gray-400 font-black text-lg py-4 rounded-full cursor-not-allowed"
                                }
                                onClick={handleAddToCart}
                            >
                                {selectedAvailable ? 'Add to Cart' : 'Not available'}
                            </motion.button>
                        ) : (
                            <div className="rounded-2xl border-2 border-gray-200 bg-hackclub-smoke p-5 text-center">
                                <p className="text-hackclub-dark font-bold">
                                    This item isn&apos;t available for {isGuest ? 'card purchase' : 'points'}.
                                </p>
                                {isGuest && (
                                    <p className="mt-1 text-sm text-hackclub-slate font-medium">
                                        Sign in with Hack Club to buy with points.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductPage;
