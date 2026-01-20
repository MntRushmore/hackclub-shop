'use client';

import React, { useEffect, useState, useContext } from "react";
import { useParams } from "next/navigation";
import { CartContext } from "../../../context/CartContext";
import Image from 'next/image';
import { ProductDetail, Variant } from '../../../types/Product';
import { motion } from 'framer-motion';


const ProductPage = () => {
    const params = useParams();
    const productId = params.id;

    const { addToCart } = useContext(CartContext)!;

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
        if (product && selectedVariant) {
            const cartItem = {
                name: selectedVariant.name,
                price: selectedVariant.retail_price,
                thumbnail_url: selectedVariant.product.image,
                variant_id: selectedVariant.variant_id,
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
                        
                        <p className="text-4xl font-black text-hackclub-red mb-8">
                            ${parseFloat(selectedVariant?.retail_price || '0.00').toFixed(2)}
                        </p>

                        {variants.length > 0 && (
                            <div className="mb-8">
                                <label htmlFor="variant" className="block text-lg font-bold text-hackclub-dark mb-3">
                                    Select Variant:
                                </label>
                                <select
                                    id="variant"
                                    value={selectedVariant?.variant_id || ''}
                                    onChange={(e) => {
                                        const variant = variants.find(v => v.variant_id === parseInt(e.target.value));
                                        setSelectedVariant(variant || null);
                                    }}
                                    className="border-2 border-gray-300 rounded-xl p-3 w-full bg-white text-hackclub-dark font-bold focus:outline-none focus:border-hackclub-red transition-colors"
                                >
                                    {variants.map((variant) => (
                                        <option key={variant.variant_id} value={variant.variant_id}>
                                            {variant.size} / {variant.color}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black text-lg py-4 rounded-full transition-all shadow-lg hover:shadow-xl"
                            onClick={handleAddToCart}
                        >
                            Add to Cart
                        </motion.button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductPage;