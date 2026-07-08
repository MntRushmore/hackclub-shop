'use client';

import React, { useState, useEffect, useContext, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { CartContext } from '../../context/CartContext';
import { CardSkeleton } from '../components/Skeleton';
import { getCashPrice, getPointsPrice, getDisplayPrice, isAvailableOn } from '../../lib/paymentUtils';
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
    available?: number | null; // null = unlimited; number = units left
    product: { image: string };
}

interface Product {
    id: string | number;
    name: string;
    description?: string;
    thumbnail_url: string;
    category?: string | null;
    createdAt?: string | null;
    // Donation tier marker (see src/lib/donation.ts): the cash price is the
    // donation amount; the merch is the thank-you gift.
    donation?: { tier: string; fmvCents: number; plus?: boolean; giftPicks?: number } | null;
    sync_variants: Variant[];
}

type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'newest' | 'name';

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
    const { pathway, loading: pathwayLoading, isAdmin, isAdminMode, setAdminMode } = usePathway();

    // Catalog controls.
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState<string>('all');
    const [sort, setSort] = useState<SortKey>('featured');

    // Strict path separation: while auth resolves, show everything; once
    // resolved, only show products with at least one variant the active
    // pathway can actually buy.
    const pathwayProducts = useMemo(
        () =>
            pathwayLoading
                ? products
                : products.filter((product) =>
                      (product.sync_variants || []).some((variant) => isAvailableOn(variant, pathway)),
                  ),
        [products, pathway, pathwayLoading],
    );

    // Donation pivot: tier products render as the ladder up top (anchored
    // high — biggest ask first); everything else stays in the classic grid.
    const donationTiers = useMemo(
        () =>
            pathwayProducts
                .filter((p) => p.donation)
                .sort((a, b) => (getCashPrice(b.sync_variants?.[0]) || 0) - (getCashPrice(a.sync_variants?.[0]) || 0)),
        [pathwayProducts],
    );
    const retailProducts = useMemo(() => pathwayProducts.filter((p) => !p.donation), [pathwayProducts]);

    // Distinct categories present in the pathway-visible grid (for the chips).
    const categories = useMemo(() => {
        const set = new Set<string>();
        for (const p of retailProducts) {
            if (p.category && p.category.trim()) set.add(p.category.trim());
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [retailProducts]);

    // The pathway-aware unit price used for sorting/searching.
    const priceFor = (p: Product): number => {
        const v = p.sync_variants?.[0];
        if (!v) return 0;
        return (pathway === 'student' ? getPointsPrice(v) : getCashPrice(v)) || 0;
    };

    // Search → category → sort, layered on top of the pathway filter.
    const visibleProducts = useMemo(() => {
        const q = query.trim().toLowerCase();
        let list = retailProducts;
        if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
        if (category !== 'all') list = list.filter((p) => (p.category || '').trim() === category);

        const sorted = [...list];
        switch (sort) {
            case 'price-asc':
                sorted.sort((a, b) => priceFor(a) - priceFor(b));
                break;
            case 'price-desc':
                sorted.sort((a, b) => priceFor(b) - priceFor(a));
                break;
            case 'name':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'newest':
                sorted.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
                break;
            default:
                break; // 'featured' = catalog order
        }
        return sorted;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathwayProducts, query, category, sort, pathway]);

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

                if (isNearCart && product.sync_variants && product.sync_variants.length > 0 && isAvailableOn(product.sync_variants[0], pathway) && product.sync_variants[0].available !== 0 && cartContext) {
                    droppedOnCart = true;
                    const variant = product.sync_variants[0];

                    const variantId = variant.variant_id || variant.id || `${product.id}_var_0`;
                    cartContext.addToCart({
                        id: product.id,
                        name: variant.name,
                        price: String(getCashPrice(variant) || getPointsPrice(variant)),
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
            animate={{ opacity: 1 }}
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
                <div className="mb-8">
                    <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-4" style={{ letterSpacing: "-0.02em" }}>
                        Back a teenager.
                    </h1>
                    <p className="text-xl text-hackclub-slate font-bold max-w-3xl">
                        Nearly 10,000 teenagers have led a club, built a
                        portfolio-ready technical project, or organized a
                        hackathon at Hack Club since 2014. And more than 25,000
                        have traveled to build projects with friends at our
                        in-person hackathons.
                    </p>
                    <p className="text-xl text-hackclub-slate font-bold max-w-3xl mt-4">
                        We can keep Hack Club free for all teens. Shop our
                        exclusive-to-parents merch and make your gift to Hack
                        Club teenagers.
                    </p>
                    {/* Trust strip: carries the homepage's nonprofit framing into the
                        buy flow so the reason-to-give doesn't evaporate at the door. */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 text-sm font-bold text-hackclub-muted">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="text-hackclub-red">●</span> 501(c)(3) nonprofit
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="text-hackclub-red">●</span> Tax-deductible above the gift&apos;s value
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="text-hackclub-red">●</span> Ships to your door
                        </span>
                    </div>
                </div>

                {/* Donation tier ladder — anchored high (biggest ask first). */}
                {!loading && donationTiers.length > 0 && (
                    <div className="mb-14">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {donationTiers.map((tier) =>
                                tier.donation?.tier === 'Philanthropist' ? (
                                    <PhilanthropistSplit key={tier.id} product={tier} />
                                ) : (
                                    <TierCard key={tier.id} product={tier} />
                                ),
                            )}
                            <SustainerCard />
                        </div>
                        <p className="mt-6 text-center text-hackclub-slate font-bold">
                            Want to give a higher amount? You can add more to any product
                            at checkout.
                        </p>
                    </div>
                )}

                {/* Grid controls + retail grid: shown only while the catalog still
                    has non-tier products (admin full-catalog mode, leftovers). The
                    pivoted storefront is usually just the ladder above. */}
                {!loading && donationTiers.length > 0 && retailProducts.length > 0 && (
                    <h2 className="text-2xl font-black text-hackclub-dark mb-5">More from the shop</h2>
                )}
                {/* Search + sort */}
                {(loading || retailProducts.length > 0) && (
                <div className="flex flex-col sm:flex-row gap-3 mb-5">
                    <div className="relative flex-1">
                        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-hackclub-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search products…"
                            aria-label="Search products"
                            className="w-full pl-11 pr-4 py-3 rounded-full border-2 border-hackclub-smoke bg-white text-hackclub-dark font-medium focus:outline-none focus-visible:border-hackclub-red focus-visible:ring-2 focus-visible:ring-hackclub-red/40 transition-colors"
                        />
                    </div>
                    <label className="sr-only" htmlFor="sort">Sort products</label>
                    <select
                        id="sort"
                        value={sort}
                        onChange={(e) => setSort(e.target.value as SortKey)}
                        className="px-4 py-3 rounded-full border-2 border-hackclub-smoke bg-white text-hackclub-dark font-bold focus:outline-none focus-visible:border-hackclub-red focus-visible:ring-2 focus-visible:ring-hackclub-red/40 transition-colors"
                    >
                        <option value="featured">Featured</option>
                        <option value="price-asc">Price: low to high</option>
                        <option value="price-desc">Price: high to low</option>
                        <option value="newest">Newest</option>
                        <option value="name">Name (A to Z)</option>
                    </select>
                </div>
                )}

                {/* Category chips */}
                {categories.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-10">
                        <CategoryChip label="All" active={category === 'all'} onClick={() => setCategory('all')} />
                        {categories.map((c) => (
                            <CategoryChip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
                        ))}
                    </div>
                )}

                {/* Admin-only: reveal the full catalog (points + cash items) and pick
                    how to pay per order at checkout. Off by default so an admin
                    shopping as a normal student isn't surprised. */}
                {isAdmin && (
                    <label className="flex items-center gap-3 mb-8 px-4 py-3 rounded-2xl bg-hackclub-smoke/40 border-2 border-hackclub-smoke w-fit cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={isAdminMode}
                            onChange={(e) => setAdminMode(e.target.checked)}
                            className="w-4 h-4 accent-hackclub-red cursor-pointer"
                        />
                        <span className="font-bold text-hackclub-dark text-sm">
                            Admin: show all products
                        </span>
                        <span className="text-hackclub-muted text-xs">
                            {isAdminMode ? 'Viewing every product. Pick points or Hack Club Bank at checkout.' : 'Currently shopping the public storefront.'}
                        </span>
                    </label>
                )}

                {error && (
                    <div className="text-center py-20">
                        <p className="text-hackclub-red text-lg font-bold">⚠️ {error}</p>
                    </div>
                )}

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
                    </div>
                ) : !error && visibleProducts.length === 0 && !(donationTiers.length > 0 && retailProducts.length === 0) ? (
                    <div className="text-center py-20">
                        <div className="w-16 h-16 bg-hackclub-smoke rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-hackclub-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                            </svg>
                        </div>
                        <p className="text-hackclub-dark font-black text-lg">
                            {query || category !== 'all' ? 'Nothing matches that' : 'New products coming soon'}
                        </p>
                        <p className="text-hackclub-slate font-medium mt-1">
                            {query || category !== 'all' ? 'Try a different search or category.' : 'Check back soon for new ways to support Hack Club.'}
                        </p>
                        {(query || category !== 'all') && (
                            <button
                                type="button"
                                onClick={() => { setQuery(''); setCategory('all'); }}
                                className="mt-5 inline-block bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-6 py-2.5 rounded-full transition-colors"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {visibleProducts.map((product) => {
                      const firstVariant = product.sync_variants?.[0];
                      const soldOut = firstVariant?.available === 0;
                      const lowStock = typeof firstVariant?.available === 'number' && firstVariant.available > 0 && firstVariant.available <= 5;
                      const canBuy = firstVariant ? isAvailableOn(firstVariant, pathway) && !soldOut : false;
                      return (
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
                                    className={`object-contain p-6 group-hover:scale-105 transition-transform duration-300 pointer-events-none ${soldOut ? 'opacity-40 grayscale' : ''}`}
                                    draggable={false}
                                />
                                {soldOut && (
                                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-black bg-hackclub-dark text-white">
                                        Sold out
                                    </span>
                                )}
                                {!soldOut && lowStock && (
                                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-black bg-hackclub-orange text-white">
                                        Only {firstVariant!.available} left
                                    </span>
                                )}
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
                                        disabled={!canBuy}
                                        className={
                                            canBuy
                                                ? "bg-hackclub-red hover:bg-hackclub-orange text-white font-bold px-4 py-1 rounded-full shadow transition-all duration-200 text-sm opacity-0 group-hover:opacity-100 focus:opacity-100 ml-auto"
                                                : "bg-gray-200 text-gray-400 font-bold px-4 py-1 rounded-full transition-opacity duration-200 text-sm opacity-0 group-hover:opacity-100 focus:opacity-100 ml-auto cursor-not-allowed"
                                        }
                                        onClick={(e) => {
                                             e.stopPropagation();
                                             e.preventDefault();
                                             if (canBuy && firstVariant && cartContext) {
                                                  const variant = firstVariant;

                                                  const variantId = variant.variant_id || variant.id || `${product.id}_var_0`;
                                                   cartContext.addToCart({
                                                       id: product.id,
                                                       name: variant.name,
                                                       price: String(getCashPrice(variant) || getPointsPrice(variant)),
                                                       price_cash: getCashPrice(variant) || undefined,
                                                       price_points: getPointsPrice(variant) || undefined,
                                                       thumbnail_url: variant.product.image,
                                                       variant_id: variantId,
                                                   });
                                             }
                                             e.currentTarget.blur();
                                         }}
                                    >
                                        {canBuy ? 'Add to Cart' : soldOut ? 'Sold out' : 'Not available'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                      );
                    })}
                </div>
                )}

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

/**
 * One rung of the donation ladder. The whole card links to the product page,
 * where the donor picks their gift/size — carts and checkout treat tiers as
 * ordinary products (the donation split happens server-side).
 */
function TierCard({ product }: { product: Product }) {
    const firstVariant = product.sync_variants?.[0];
    const amount = getCashPrice(firstVariant) || 0;
    const soldOut =
        product.sync_variants.length > 0 && product.sync_variants.every((v) => v.available === 0);
    const deductible = Math.max(0, amount - (product.donation?.fmvCents ?? 0) / 100);
    const dollars = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

    // The gifts stay a footnote (small thumbs, never the card's hero), but each
    // DISTINCT piece gets its own thumb so the ladder visibly escalates: one
    // bumper sticker at $25, a whole row with "pick any two" at $1,000. Variants
    // are deduped to pieces by name (sizes share a photo); a variant whose
    // image just falls back to the tier photo has no piece photo yet and is
    // skipped, unless that leaves the row empty (single-gift tiers).
    const pieces = (() => {
        const seen = new Set<string>();
        const out: { name: string; image: string }[] = [];
        for (const v of product.sync_variants || []) {
            const img = v.product?.image;
            if (!img || img === product.thumbnail_url) continue;
            const name = v.name.split(' · ')[0];
            if (seen.has(name)) continue;
            seen.add(name);
            out.push({ name, image: img });
        }
        if (out.length === 0 && firstVariant?.product?.image) {
            out.push({ name: firstVariant.name.split(' · ')[0], image: firstVariant.product.image });
        }
        return out;
    })();
    const giftPicks = product.donation?.giftPicks || 1;
    const giftCaption = soldOut
        ? 'Thank-you gifts fully claimed'
        : giftPicks > 1
        ? 'Your thank-you gifts: pick any two'
        : pieces.length > 1
        ? 'Your thank-you gift: pick one'
        : `Your thank-you gift: ${pieces[0]?.name.toLowerCase() || 'included'}`;

    return (
        <Link
            href={`/products/${product.id}`}
            className={`group relative flex flex-col bg-white rounded-2xl shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden border-2 ${
                product.donation?.plus ? 'border-hackclub-red/60' : 'border-gray-200'
            } hover:border-hackclub-red ${soldOut ? 'opacity-60' : ''}`}
        >
            {/* VIP badge on the open-ended top rung — same flat badge language
                as the Sold out pill, nothing decorative. */}
            {product.donation?.plus && (
                <span className="absolute top-4 right-4 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest bg-hackclub-dark text-white">
                    VIP
                </span>
            )}
            <div className="flex flex-col gap-2 p-6 flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-hackclub-red">
                    {product.donation?.tier}
                </p>
                <p className="text-4xl font-black text-hackclub-dark" style={{ letterSpacing: '-0.02em' }}>
                    {dollars(amount)}{product.donation?.plus ? '+' : <span className="text-xl text-hackclub-muted">/mo</span>}
                </p>
                {product.description && (
                    <p className="text-sm text-hackclub-slate font-medium leading-relaxed line-clamp-3">
                        {product.description}
                    </p>
                )}
                {pieces.length > 0 && (
                    <div className="mt-2">
                        <p className="text-xs font-bold text-hackclub-muted mb-2">{giftCaption}</p>
                        <div className="flex flex-wrap gap-2">
                            {pieces.map((piece) => (
                                <Image
                                    key={piece.name}
                                    src={piece.image}
                                    alt={piece.name}
                                    title={piece.name}
                                    width={96}
                                    height={96}
                                    className="w-24 h-24 rounded-xl object-cover border-2 border-hackclub-smoke bg-hackclub-smoke"
                                    draggable={false}
                                />
                            ))}
                        </div>
                    </div>
                )}
                <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                    {deductible > 0 && (
                        <span className="text-xs font-bold text-hackclub-muted">
                            ~{dollars(deductible)} tax-deductible
                        </span>
                    )}
                    <span className={`ml-auto inline-flex items-center gap-1 font-black text-sm px-5 py-2 rounded-full transition-colors ${
                        soldOut
                            ? 'bg-gray-200 text-gray-400'
                            : 'bg-hackclub-red text-white group-hover:bg-hackclub-orange'
                    }`}>
                        {soldOut ? 'Fully claimed' : `Donate ${dollars(amount)}${product.donation?.plus ? '+' : '/mo'}`}
                        {!soldOut && (
                            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        )}
                    </span>
                </div>
            </div>
        </Link>
    );
}

/**
 * The Philanthropist cell splits into two half-height boxes, one aimed at
 * dads (the vest) and one at moms (the Mom hoodie). Same product,
 * same $500, same checkout; only the pitch differs. Both link to the tier
 * page, where the donor can still pick any gift.
 */
function PhilanthropistSplit({ product }: { product: Product }) {
    const firstVariant = product.sync_variants?.[0];
    const amount = getCashPrice(firstVariant) || 0;
    const soldOut =
        product.sync_variants.length > 0 && product.sync_variants.every((v) => v.available === 0);
    const deductible = Math.max(0, amount - (product.donation?.fmvCents ?? 0) / 100);
    const dollars = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    const imageFor = (prefix: string) =>
        product.sync_variants.find((v) => v.name.startsWith(prefix))?.product?.image;

    const halves = [
        { who: 'For dads', image: imageFor('Vest') || '/gifts/vest.jpg', line: 'Your thanks is the Hack Club vest.' },
        { who: 'For moms', image: imageFor('Mom Sweatshirt') || '/gifts/mom-sweatshirt.jpg', line: 'Your thanks is the Mom hoodie. It says it right on the front.' },
    ];

    return (
        <div className={`flex flex-col gap-6 ${soldOut ? 'opacity-60' : ''}`}>
            {halves.map((half) => (
                <Link
                    key={half.who}
                    href={`/products/${product.id}`}
                    className="group flex flex-col flex-1 bg-white rounded-2xl shadow-md hover:shadow-2xl transition-all duration-300 border-2 border-gray-200 hover:border-hackclub-red p-6 gap-2"
                >
                    <p className="text-xs font-black uppercase tracking-widest text-hackclub-red">
                        {product.donation?.tier} · {half.who}
                    </p>
                    <p className="text-3xl font-black text-hackclub-dark" style={{ letterSpacing: '-0.02em' }}>
                        {dollars(amount)}<span className="text-lg text-hackclub-muted">/mo</span>
                    </p>
                    <div className="flex items-center gap-3">
                        {half.image && (
                            <Image
                                src={half.image}
                                alt={half.who}
                                width={96}
                                height={96}
                                className="w-24 h-24 rounded-xl object-cover border-2 border-hackclub-smoke bg-hackclub-smoke"
                                draggable={false}
                            />
                        )}
                        <p className="text-sm text-hackclub-slate font-medium leading-snug">{half.line}</p>
                    </div>
                    <div className="mt-auto pt-2 flex items-center justify-between gap-2">
                        {deductible > 0 && (
                            <span className="text-xs font-bold text-hackclub-muted">
                                ~{dollars(deductible)} tax-deductible
                            </span>
                        )}
                        <span className={`ml-auto inline-flex items-center gap-1 font-black text-sm px-5 py-2 rounded-full transition-colors ${
                            soldOut
                                ? 'bg-gray-200 text-gray-400'
                                : 'bg-hackclub-red text-white group-hover:bg-hackclub-orange'
                        }`}>
                            {soldOut ? 'Fully claimed' : `Donate ${dollars(amount)}/mo`}
                            {!soldOut && (
                                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            )}
                        </span>
                    </div>
                </Link>
            ))}
        </div>
    );
}

/**
 * The recurring rung: $25/month Sustainer. Not a catalog product — the button
 * POSTs to the subscription checkout route and hands off to Stripe (which also
 * collects the donor-wall name). Sits last in the ladder as the "can't pick a
 * tier? just stay close" option.
 */
function SustainerCard() {
    const [starting, setStarting] = useState(false);
    const [failed, setFailed] = useState(false);

    const start = async () => {
        setStarting(true);
        setFailed(false);
        try {
            const res = await fetch('/api/checkout/sustain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const data = await res.json();
            if (res.ok && data.url) {
                window.location.href = data.url;
                return;
            }
            setFailed(true);
        } catch {
            setFailed(true);
        }
        setStarting(false);
    };

    return (
        <div className="flex flex-col bg-hackclub-dark text-white rounded-2xl shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden border-2 border-hackclub-dark">
            <div className="flex flex-col gap-2 p-6 flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-hackclub-red">Sustainer</p>
                <p className="text-4xl font-black" style={{ letterSpacing: '-0.02em' }}>
                    $500<span className="text-xl text-white/60">/month</span>
                </p>
                <p className="text-sm text-white/70 font-medium leading-relaxed">
                    Our biggest commitment: a monthly donation with a permanent spot on
                    the donor wall and a members-only thank-you gift each year. Cancel
                    anytime.
                </p>
                {failed && (
                    <p className="text-sm font-bold text-hackclub-red">Couldn&apos;t start checkout. Please try again.</p>
                )}
                <div className="mt-auto pt-3 flex items-center justify-end">
                    <button
                        type="button"
                        onClick={start}
                        disabled={starting}
                        className={`inline-flex items-center gap-1 font-black text-sm px-5 py-2 rounded-full transition-colors ${
                            starting ? 'bg-white/20 text-white/60 cursor-wait' : 'bg-hackclub-red text-white hover:bg-hackclub-orange'
                        }`}
                    >
                        {starting ? 'Starting…' : 'Become a Sustainer'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`px-4 py-1.5 rounded-full text-sm font-bold border-2 transition-colors ${
                active
                    ? 'bg-hackclub-red text-white border-hackclub-red'
                    : 'bg-white text-hackclub-slate border-hackclub-smoke hover:border-hackclub-red hover:text-hackclub-red'
            }`}
        >
            {label}
        </button>
    );
}

export default Shop;
