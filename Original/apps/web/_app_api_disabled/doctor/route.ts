import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const file = await fs.readFile(path.join(process.cwd(), '..', 'doctor.json'), 'utf8');
    return NextResponse.json(JSON.parse(file));
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return NextResponse.json({ errors: [], warnings: [] });
    }

    return NextResponse.json(
      { errors: [err.message || String(err)], warnings: [] },
      { status: 500 },
    );
  }
}

