import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

export async function GET() {
  try {
    const jsonDirectory = path.join(process.cwd(), 'src', 'data');
    const fileContents = await fs.readFile(jsonDirectory + '/products.json', 'utf8');
    const products = JSON.parse(fileContents);
    
    return NextResponse.json({ code: 200, result: products });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ code: 500, message: 'Failed to load products' }, { status: 500 });
  }
}
