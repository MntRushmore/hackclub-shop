'use client';

import React, { useEffect, useState, useContext } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from 'next/link';
import { CartContext } from "../../../context/CartContext";
import Image from 'next/image';
import { ProductDetail, Variant } from '../../../types/Product';
import { motion } from 'framer-motion';
import { getCashPrice, getPointsPrice, getDisplayPrice, isAvailableOn } from '../../../lib/paymentUtils';
import { usePathway } from '../../../lib/usePathway';


const ProductPage = () => {
    const params = useParams();
    const productId = params.id;
    const router = useRouter();

    const { addToCart } = useContext(CartContext)!;
    const { pathway, isGuest } = usePathway();

    const [product, setProduct] = useState<ProductDetail | null>(null);
    // Donation frequency. Monthly is the default for every tier except the
    // open-ended top tier (donation.plus), which starts as a one-time gift.
    const [monthly, setMonthly] = useState(true);
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
                if (data.result.sync_product?.donation?.plus) setMonthly(false);

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

    const isInStock = (v: Variant | null) => !v || v.available === undefined || v.available === null || v.available > 0;

    const handleAddToCart = () => {
        if (product && selectedVariant && isAvailableOn(selectedVariant, pathway) && isInStock(selectedVariant)) {
            const cartItem = {
                id: product.id,
                name: selectedVariant.name,
                price: String(getCashPrice(selectedVariant) || getPointsPrice(selectedVariant)),
                price_cash: getCashPrice(selectedVariant) || undefined,
                price_points: getPointsPrice(selectedVariant) || undefined,
                thumbnail_url: selectedVariant.product.image,
                variant_id: selectedVariant.variant_id || selectedVariant.id,
            };

            addToCart(cartItem);
        }
    };

    // Donation tiers skip the variant picker entirely: the button carts the
    // first in-stock gift as a placeholder (the donor picks their actual gift
    // and size at checkout) and heads straight to checkout. The cart line is
    // named after the tier, not the placeholder gift.
    const handleDonate = () => {
        if (!product) return;
        const first = variants.find((v) => isAvailableOn(v, pathway) && isInStock(v));
        if (!first) return;
        addToCart({
            id: product.id,
            name: `${product.donation?.tier || product.name} donation`,
            price: String(getCashPrice(first) || 0),
            price_cash: getCashPrice(first) || undefined,
            price_points: getPointsPrice(first) || undefined,
            thumbnail_url: first.product.image,
            variant_id: first.variant_id || first.id,
            recurring: monthly,
        });
        router.push('/checkout');
    };

    if (loading) {
        // Skeleton mirrors the real two-column layout (image card + details card)
        // so the page doesn't jump when the product loads.
        return (
            <div className="min-h-screen bg-white" style={{
                backgroundImage: `
                  linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                  linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12" aria-busy="true" aria-label="Loading product">
                    <div className="grid md:grid-cols-2 gap-12 items-start animate-pulse">
                        <div className="bg-white rounded-2xl p-8 shadow-lg border-2 border-gray-200">
                            <div className="w-full aspect-square rounded-xl bg-hackclub-smoke" />
                        </div>
                        <div className="bg-white rounded-2xl p-8 shadow-lg border-2 border-gray-200 space-y-6">
                            <div className="h-10 w-3/4 rounded-lg bg-hackclub-smoke" />
                            <div className="h-8 w-1/3 rounded-lg bg-hackclub-smoke" />
                            <div className="h-12 w-full rounded-xl bg-hackclub-smoke" />
                            <div className="h-12 w-full rounded-full bg-hackclub-smoke" />
                        </div>
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
                    <div className="max-w-md mx-auto text-center space-y-4">
                        <h1 className="text-3xl font-black text-hackclub-dark">
                            {error ? "We couldn't load this product" : 'Product not found'}
                        </h1>
                        <p className="text-hackclub-muted font-medium">
                            It may have sold out or moved. Try heading back to the shop.
                        </p>
                        <Link
                            href="/shop"
                            className="inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-black px-6 py-3 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hackclub-red/50"
                        >
                            Back to shop
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // Donation tier: reframe price/CTA/copy around the donation, not the merch.
    const donation = product.donation || null;
    // Distinct gift pieces (sizes share a photo, so dedupe by name). A variant
    // whose image just falls back to the tier photo has no piece photo yet and
    // is skipped, unless that would leave the row empty (single-gift tiers).
    const giftPieces = (() => {
        if (!donation) return [] as { name: string; image: string }[];
        const seen = new Set<string>();
        const out: { name: string; image: string }[] = [];
        for (const v of variants) {
            const img = v.product?.image;
            if (!img || img === product.thumbnail_url) continue;
            const name = v.name.split(' · ')[0];
            if (seen.has(name)) continue;
            seen.add(name);
            out.push({ name, image: img });
        }
        if (out.length === 0 && variants[0]?.product.image) {
            out.push({ name: variants[0].name.split(' · ')[0], image: variants[0].product.image });
        }
        return out;
    })();
    const donationAmount = donation ? getCashPrice(selectedVariant || undefined) || 0 : 0;
    const donationDeductible = donation ? Math.max(0, donationAmount - donation.fmvCents / 100) : 0;
    const dollars = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

    // Strict path separation: a variant is buyable only if it's priced for the
    // active pathway, and the product is only purchasable at all if at least one
    // variant is.
    const selectedInStock = isInStock(selectedVariant);
    const selectedAvailable = !!selectedVariant && isAvailableOn(selectedVariant, pathway) && selectedInStock;
    const anyVariantAvailable = variants.some((variant) => isAvailableOn(variant, pathway));
    // Donation tiers: buyable while ANY gift option still has stock (the donor
    // picks the exact gift/size at checkout).
    const anyGiftInStock = variants.some((v) => isAvailableOn(v, pathway) && isInStock(v));
    const selectedStock = selectedVariant?.available;
    const selectedLow = typeof selectedStock === 'number' && selectedStock > 0 && selectedStock <= 5;

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
                        {/* Donation tiers lead with the cause, never the merch: the
                            branded panel is the hero and the gift is a small labeled
                            preview below it. Retail products keep the product photo. */}
                        {!product.donation && (selectedVariant?.product.image || product.thumbnail_url) ? (
                            <Image
                                src={selectedVariant?.product.image || product.thumbnail_url}
                                alt={product.name}
                                width={600}
                                height={600}
                                className="w-full h-auto object-contain"
                            />
                        ) : (
                            <div className="aspect-square w-full rounded-xl bg-hackclub-dark flex flex-col items-center justify-center text-center p-8">
                                <span className="text-xs font-black uppercase tracking-widest text-hackclub-red mb-3">
                                    {product.donation ? `${product.donation.tier} tier` : 'Hack Club Shop'}
                                </span>
                                <span className="text-white font-black text-4xl" style={{ letterSpacing: '-0.02em' }}>
                                    {product.name}
                                </span>
                                {product.donation?.impact && (
                                    <span className="text-white/80 font-bold mt-4 max-w-xs">
                                        {product.donation.impact}
                                    </span>
                                )}
                            </div>
                        )}
                        {product.donation && giftPieces.length > 0 && (
                            <div className="mt-5">
                                <p className="text-sm font-bold text-hackclub-slate mb-2">
                                    {(product.donation.giftPicks || 1) > 1
                                        ? 'Your thank-you gifts. Pick any two at checkout.'
                                        : giftPieces.length > 1 || variants.length > 1
                                        ? 'Your thank-you gift. Pick one at checkout.'
                                        : 'Your thank-you gift. It ships to your door.'}
                                </p>
                                <div className="flex flex-wrap gap-2.5">
                                    {giftPieces.map((piece) => (
                                        <Image
                                            key={piece.name}
                                            src={piece.image}
                                            alt={piece.name}
                                            title={piece.name}
                                            width={80}
                                            height={80}
                                            className="w-20 h-20 rounded-xl object-cover border-2 border-hackclub-smoke bg-hackclub-smoke"
                                            draggable={false}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-white rounded-2xl p-8 shadow-lg border-2 border-gray-200">
                        {donation && (
                            <p className="text-xs font-black uppercase tracking-widest text-hackclub-red mb-2">
                                {donation.tier} tier
                            </p>
                        )}
                        <h1 className="text-4xl sm:text-5xl font-black text-hackclub-dark mb-4">
                            {product.name}
                        </h1>
                        {donation?.impact && (
                            <p className="text-lg font-bold text-hackclub-dark mb-3">{donation.impact}</p>
                        )}
                        {donation && product.description && (
                            <p className="text-hackclub-slate leading-relaxed mb-4">{product.description}</p>
                        )}

                        {selectedVariant && (
                            <div className="mb-8">
                                {donation ? (
                                    <>
                                        <p className="text-3xl font-black text-hackclub-red">
                                            {dollars(donationAmount)}{donation.plus ? '+' : ''}{monthly ? <span className="text-xl text-hackclub-muted">/month</span> : ''} donation
                                        </p>
                                        {donationDeductible > 0 && (
                                            <p className="mt-1 text-sm font-bold text-hackclub-muted">
                                                ~{dollars(donationDeductible)}{donation.plus ? '+' : ''} tax-deductible · 501(c)(3)
                                            </p>
                                        )}
                                    </>
                                ) : getDisplayPrice(selectedVariant, pathway) ? (
                                    <p className="text-3xl font-black text-hackclub-red">
                                        {getDisplayPrice(selectedVariant, pathway)}
                                    </p>
                                ) : (
                                    <p className="text-lg text-gray-400 font-medium">Not available</p>
                                )}
                                {/* Stock badges are for retail only. Donation tiers track
                                    stock per gift variant, and the donor picks their gift at
                                    checkout, so per-variant scarcity here is just noise. */}
                                {!donation && selectedStock === 0 ? (
                                    <p className="mt-2 inline-block px-3 py-1 rounded-full text-sm font-black bg-hackclub-dark text-white">Sold out</p>
                                ) : !donation && selectedLow ? (
                                    <p className="mt-2 inline-block px-3 py-1 rounded-full text-sm font-black bg-hackclub-orange text-white">Only {selectedStock} left</p>
                                ) : null}
                            </div>
                        )}

                        {!donation && variants.length > 0 && (
                            <div className="mb-8">
                                <label htmlFor="variant" className="block text-lg font-bold text-hackclub-dark mb-3">
                                    Choose your size:
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
                                    className="border-2 border-gray-300 rounded-xl p-3 w-full bg-white text-hackclub-dark font-bold focus:outline-none focus-visible:border-hackclub-red focus-visible:ring-2 focus-visible:ring-hackclub-red/40 transition-colors"
                                >
                                    {variants.map((variant, idx) => (
                                        <option
                                            key={`${variant.id || variant.variant_id}_${idx}`}
                                            value={variant.id || variant.variant_id}
                                            disabled={variant.available === 0}
                                        >
                                            {donation
                                                ? variant.name
                                                : `${variant.size || 'Default'} / ${variant.color || 'Default'}${getDisplayPrice(variant, pathway) ? ` - ${getDisplayPrice(variant, pathway)}` : ''}`}
                                            {variant.available === 0 ? (donation ? ' (fully claimed)' : ' (sold out)') : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {anyVariantAvailable ? (
                            <>
                                {donation && (
                                    <div className="mb-4">
                                        <div className="flex gap-2">
                                            {([true, false] as const).map((m) => (
                                                <button
                                                    key={String(m)}
                                                    type="button"
                                                    onClick={() => setMonthly(m)}
                                                    className={`flex-1 px-4 py-2 rounded-full font-bold text-sm transition-colors border-2 ${
                                                        monthly === m
                                                            ? 'bg-hackclub-red border-hackclub-red text-white'
                                                            : 'bg-white border-hackclub-smoke text-hackclub-slate hover:border-hackclub-slate'
                                                    }`}
                                                >
                                                    {m ? 'Monthly' : 'One-time'}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="mt-2 text-xs font-bold text-hackclub-muted">
                                            {monthly
                                                ? 'Monthly keeps a teenager backed all year. Cancel anytime.'
                                                : 'A single donation. You can always switch to monthly.'}
                                        </p>
                                    </div>
                                )}
                                <motion.button
                                    whileHover={donation || selectedAvailable ? { scale: 1.05 } : undefined}
                                    whileTap={donation || selectedAvailable ? { scale: 0.95 } : undefined}
                                    disabled={donation ? !anyGiftInStock : !selectedAvailable}
                                    className={
                                        (donation ? anyGiftInStock : selectedAvailable)
                                            ? "w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black text-lg py-4 rounded-full transition-all shadow-lg hover:shadow-xl"
                                            : "w-full bg-gray-200 text-gray-400 font-black text-lg py-4 rounded-full cursor-not-allowed"
                                    }
                                    onClick={donation ? handleDonate : handleAddToCart}
                                >
                                    {donation
                                        ? (anyGiftInStock ? `Donate ${dollars(donationAmount)}${donation.plus ? '+' : ''}${monthly ? '/month' : ''} →` : 'Fully claimed')
                                        : selectedAvailable ? 'Add to Cart' : !selectedInStock ? 'Sold out' : 'Not available'}
                                </motion.button>
                                {donation && (
                                    <p className="mt-3 text-center text-sm font-bold text-hackclub-muted">
                                        {(donation.giftPicks || 1) > 1
                                            ? "You'll pick your two thank-you gifts at checkout."
                                            : variants.length > 1
                                            ? "You'll pick your thank-you gift and size at checkout."
                                            : `Your thank-you gift: ${variants[0]?.name || 'included'}.`}
                                    </p>
                                )}
                            </>
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

                        {/* The closer: the product page is where the buy decision happens,
                            so reinforce WHY (nonprofit, where the money goes) and remove
                            the last unknowns (shipping, tracking). Parent-first framing. */}
                        {anyVariantAvailable && (
                            <div className="mt-7 pt-7 border-t border-gray-100 space-y-4">
                                <p className="text-hackclub-slate leading-relaxed">
                                    {donation
                                        ? "Your donation funds the teenagers who build, ship, and dream at Hack Club. The merch is just our thanks."
                                        : "Every purchase supports the teenagers who build, ship, and dream at Hack Club. You're not just buying a shirt. You're backing a kid who makes."}
                                </p>
                                <ul className="space-y-2.5 text-sm font-bold text-hackclub-dark">
                                    <li className="flex items-start gap-2.5">
                                        <span className="text-hackclub-red mt-0.5">♥</span>
                                        <span>
                                            {donation
                                                ? 'Hack Club is a 501(c)(3) nonprofit (EIN 81-2908499). Your receipt doubles as your tax acknowledgment, and the portion above the gift’s value is tax-deductible.'
                                                : 'All proceeds support teenagers at Hack Club, a 501(c)(3) nonprofit (EIN 81-2908499).'}
                                        </span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <span className="text-hackclub-red mt-0.5">▸</span>
                                        <span>Ships to your door with tracking. Shipping is calculated at checkout before you pay.</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <span className="text-hackclub-red mt-0.5">⎙</span>
                                        <span>Secure checkout. Your card is entered on Stripe&apos;s encrypted page, never stored here.</span>
                                    </li>
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductPage;
