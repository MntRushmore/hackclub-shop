'use client';

import React, { useState, useContext } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CartContext } from '../../context/CartContext';
import { Product } from '../../types/Product';
import { getCashPrice, getPointsPrice, getDisplayPrice } from '../../lib/paymentUtils';
import { usePathway } from '../../lib/usePathway';

interface ProductCardProps {
    product: Product;
    gradientFrom: string;
    gradientTo: string;
}

const ProductCard: React.FC<ProductCardProps> = ({
    product,
    gradientFrom,
    gradientTo,
}) => {
    const [selectedVariantId, setSelectedVariantId] = useState<
        string | number | undefined
    >(
        product.sync_variants && product.sync_variants.length > 0
            ? product.sync_variants[0].variant_id
            : undefined
    );

    const { addToCart } = useContext(CartContext)!;
    const { pathway } = usePathway();

    const selectedVariant = product.sync_variants?.find(
        (variant) => variant.variant_id === selectedVariantId
    );

    const handleAddToCart = () => {
        if (selectedVariant) {
            const cartItem = {
                id: product.id,
                name: selectedVariant.name,
                price: String(getCashPrice(selectedVariant)),
                price_cash: getCashPrice(selectedVariant) || undefined,
                price_points: getPointsPrice(selectedVariant) || undefined,
                thumbnail_url: selectedVariant.product.image,
                variant_id: selectedVariant.variant_id,
            };
            addToCart(cartItem);
        }
    };

    return (
        <div className="flex flex-col items-center">
            <div
                className="bg-white rounded-xl shadow-md"
                style={{
                    boxShadow: '8px 8px 16px rgba(0,0,0,0.1)',
                }}
            >
                <Link href={`/products/${product.id}`} className="relative">
                    <Image
                        src={product.thumbnail_url}
                        alt={product.name}
                        width={400}
                        height={400}
                        className="w-full h-48 object-contain rounded-xl z-20"
                    />
                    {/* Gradient colors are dynamic props — Tailwind's JIT can't
                        generate from-[${var}] classes, so set it as an inline style. */}
                    <div
                        className="absolute bottom-0 right-0 w-full h-full opacity-50 rounded-md shadow-lg -z-10"
                        style={{ backgroundImage: `linear-gradient(to top, ${gradientFrom}, ${gradientTo})` }}
                    ></div>
                </Link>
            </div>

            <h3 className="text-xl font-semibold mt-4 text-hackclub-dark text-center">
                {product.name}
            </h3>

            {selectedVariant && (
                <div className="flex flex-col items-center mt-2">
                    {getDisplayPrice(selectedVariant, pathway) ? (
                        <p className="text-lg font-semibold text-gray-900">
                            {getDisplayPrice(selectedVariant, pathway)}
                        </p>
                    ) : (
                        <p className="text-sm text-gray-400 mt-1">Not available</p>
                    )}
                </div>
            )}

            {product.sync_variants && (
                <div className="flex justify-center mt-3 mb-2">
                    <select
                        value={selectedVariantId}
                        onChange={(e) => setSelectedVariantId(isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}
                        className="px-4 py-2 rounded-full border-2 border-hackclub-smoke bg-white text-hackclub-slate focus-visible:outline-none focus-visible:border-hackclub-red focus-visible:ring-2 focus-visible:ring-hackclub-red/40"
                    >
                        {product.sync_variants.map((variant) => (
                            <option key={variant.variant_id} value={variant.variant_id}>
                                {variant.size} / {variant.color}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <button
                className="mt-2 bg-hackclub-blue text-white py-2 px-4 rounded-full hover:brightness-90 transition-[filter,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hackclub-blue/50 shadow-sm"
                style={{
                    boxShadow: '4px 4px 10px rgba(0,0,0,0.1)',
                }}
                onClick={handleAddToCart}
            >
                Add to Cart
            </button>
        </div>
    );
};

export default ProductCard;
