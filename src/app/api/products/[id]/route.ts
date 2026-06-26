import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { getVariantStocks } from '../../../../lib/inventory';
import { getCatalogProduct } from '../../../../lib/catalog';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const productId = params.id;

    try {
        // Stripe is the source of truth; read from the catalog projection.
        const product = await getCatalogProduct(productId);

        // Draft products (created from an accepted sourcing quote) aren't public —
        // 404 them on the storefront just like a missing product, even by direct URL.
        if (!product || product.draft) {
            return NextResponse.json({ message: 'Product not found' }, { status: 404 });
        }

        const result = {
            sync_product: {
                id: product.id,
                name: product.name,
                thumbnail_url: product.thumbnail_url,
                shippingOptions: product.shippingOptions || [],
                checkoutFields: product.checkoutFields || [],
            },
            sync_variants: (product.variants || []).map((variant, idx) => ({
                id: variant.id || `${product.id}_var_${idx}`,
                variant_id: variant.variant_id || `${product.id}_var_${idx}`,
                name: variant.name,
                retail_price: (variant.price ?? 0).toString(),
                // Catalog variants already carry resolved dual pricing.
                ...(variant.price_cash !== undefined ? { price_cash: variant.price_cash } : {}),
                ...(variant.price_points !== undefined ? { price_points: variant.price_points } : {}),
                size: variant.size || 'One Size',
                color: variant.color || 'Default',
                product: {
                    image: variant.image_url || product.image_url || product.thumbnail_url,
                },
            })),
        };

        // Enrich variants with live availability (null = untracked/unlimited).
        const stocks = await getVariantStocks(result.sync_variants.map((v: any) => v.variant_id));
        result.sync_variants = result.sync_variants.map((v: any) => ({
            ...v,
            available: stocks[v.variant_id]?.available ?? null,
        }));

        return NextResponse.json({ result });
    } catch (error) {
         console.error(error);
         return NextResponse.json({ message: 'Error loading product' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const productId = params.id;

    try {
        const product = await redis.get<any>(`product:${productId}`);
        if (!product) {
            return NextResponse.json({ error: 'Product not found' }, { status: 404 });
        }

        const body = await req.json();
        const updated = {
            ...product,
            ...body,
            id: productId,
            createdAt: product.createdAt,
            updatedAt: new Date(),
        };

        await redis.set(`product:${productId}`, updated);
        return NextResponse.json({ product: updated });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const productId = params.id;

    try {
        await redis.del(`product:${productId}`);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
    }
}
