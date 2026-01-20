'use client';

import React, { useState, useContext } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CartContext } from '../../context/CartContext';
import { Product } from '../../types/Product';

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
        number | undefined
    >(
        product.sync_variants && product.sync_variants.length > 0
            ? product.sync_variants[0].variant_id
            : undefined
    );

    const { addToCart } = useContext(CartContext)!;

    const handleAddToCart = () => {
        const selectedVariant = product.sync_variants?.find(
            (variant) => variant.variant_id === selectedVariantId
        );
        if (selectedVariant) {
            const cartItem = {
                name: selectedVariant.name,
                price: selectedVariant.retail_price,
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
                    <div className={`absolute bottom-0 right-0 w-full h-full bg-gradient-to-t from-[${gradientFrom}] to-[${gradientTo}] opacity-50 rounded-md shadow-lg -z-10 `}></div>
                </Link>
            </div>

            < h3 className="text-xl font-semibold mt-4 text-hackclub-text text-center" >
                {product.name}
            </h3 >
            <p className="text-lg text-gray-800 mt-2">
                $
                {selectedVariantId
                    ? parseFloat(
                        product.sync_variants?.find(
                            (variant) => variant.variant_id === selectedVariantId
                        )?.retail_price || '0.00'
                    ).toFixed(2)
                    : 'N/A'}
            </p>

            {
                product.sync_variants && (
                    <div className="flex justify-center mt-2 mb-2">
                        <select
                            value={selectedVariantId}
                            onChange={(e) => setSelectedVariantId(parseInt(e.target.value))}
                            className="px-4 py-2 rounded-full border bg-white text-gray-700 focus:outline-none"
                        >
                            {product.sync_variants.map((variant) => (
                                <option key={variant.variant_id} value={variant.variant_id}>
                                    {variant.size} / {variant.color}
                                </option>
                            ))}
                        </select>
                    </div>
                )
            }

            <button
                className="mt-2 bg-[#338eda] text-white py-2 px-4 rounded-full hover:bg-[#2a6bb8] transition-colors shadow-sm"
                style={{
                    boxShadow: '4px 4px 10px rgba(0,0,0,0.1)',
                }}
                onClick={handleAddToCart}
            >
                Add to Cart
            </button>
        </div >
    );
};

export default ProductCard;
