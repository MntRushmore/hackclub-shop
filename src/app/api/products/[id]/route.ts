import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const id = parseInt(params.id);
    
    try {
        const jsonDirectory = path.join(process.cwd(), 'src', 'data');
        const fileContents = await fs.readFile(jsonDirectory + '/products.json', 'utf8');
        const products = JSON.parse(fileContents);
        
        const product = products.find((p: any) => p.id === id);

        if (!product) {
            return NextResponse.json({ message: 'Product not found' }, { status: 404 });
        }

        const result = {
            sync_product: {
                id: product.id,
                name: product.name,
                thumbnail_url: product.thumbnail_url,
            },
            sync_variants: product.sync_variants || []
        };

        return NextResponse.json({ result });
    } catch (error) {
         console.error(error);
         return NextResponse.json({ message: 'Error loading product' }, { status: 500 });
    }
}
