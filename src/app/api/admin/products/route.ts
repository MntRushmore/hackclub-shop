import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Redis } from '@upstash/redis';
import { authOptions } from '../../auth/[...nextauth]/route';
import { requireAdminPermission } from '../../../../lib/adminAuth';
import { Product } from '../../../../types/Admin';
import { mirrorProduct } from '../../../../lib/airtableMirror';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET() {
    const session = await getServerSession(authOptions);
    const canView = await requireAdminPermission(session, 'canViewStats');

    if (!canView.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const keys = await redis.keys('product:*');
        const products: Product[] = [];

        for (const key of keys) {
            const product = await redis.get<Product>(key);
            if (product) products.push(product);
        }

        return NextResponse.json({ products });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    const canManage = await requireAdminPermission(session, 'canManageProducts');

    if (!canManage.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const {
            name,
            description,
            image_url,
            thumbnail_url,
            category,
            variants,
        } = body;

        if (!name || !variants || variants.length === 0) {
            return NextResponse.json({ error: 'Missing required fields (need name and at least 1 variant)' }, { status: 400 });
        }

        const variantsInvalid = variants.some((v: any) => {
            if (!v.name) return true;
            // A variant must be buyable on at least one pathway: a cash price (USD,
            // for adults) and/or a points price (for students).
            const hasCash = v.priceCash != null && v.priceCash !== '' && parseFloat(v.priceCash) > 0;
            const hasPoints = v.pricePoints != null && v.pricePoints !== '' && parseInt(v.pricePoints) > 0;
            if (!hasCash && !hasPoints) return true;
            return false;
        });
        if (variantsInvalid) {
            return NextResponse.json({ error: 'Each variant needs a name and at least one price (cash and/or points)' }, { status: 400 });
        }

        const product: Product = {
            id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            description,
            image_url,
            thumbnail_url,
            category,
            variants: (variants || []).map((v: any, idx: number) => {
                const cash = v.priceCash != null && v.priceCash !== '' ? parseFloat(v.priceCash) : undefined;
                const points = v.pricePoints != null && v.pricePoints !== '' ? parseInt(v.pricePoints) : undefined;
                const variant: any = {
                    id: v.id || `var_${Date.now()}_${idx}`,
                    variant_id: v.variant_id || `var_${Date.now()}_${idx}`,
                    name: v.name,
                    // `price` retained as the legacy USD field (mirrors price_cash).
                    price: cash ?? parseFloat(v.price || '0'),
                    size: v.size,
                    color: v.color,
                    image_url: v.image_url,
                    stock: v.stock ? parseInt(v.stock) : undefined,
                    weightOz: v.weightOz != null && v.weightOz !== '' ? parseFloat(v.weightOz) : undefined,
                    unitCost: v.unitCost != null && v.unitCost !== '' && !Number.isNaN(parseFloat(v.unitCost)) ? Math.max(0, parseFloat(v.unitCost)) : undefined,
                };

                if (cash !== undefined && cash > 0) variant.price_cash = cash;
                if (points !== undefined && points > 0) variant.price_points = points;

                return variant;
            }),
            shippingOptions: (body.shippingOptions || []).map((s: any, idx: number) => ({
                id: s.id || `ship_${Date.now()}_${idx}`,
                country: s.country,
                cost: parseFloat(s.cost),
                costPoints: s.costPoints ? parseInt(s.costPoints) : undefined,
            })),
            checkoutFields: body.checkoutFields || [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await redis.set(`product:${product.id}`, product);
        void mirrorProduct(product);
        return NextResponse.json({ product }, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
    }
}
