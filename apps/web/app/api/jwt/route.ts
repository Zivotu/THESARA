
import { NextResponse } from "next/server";
import { signAppJwt } from "@/lib/jwt-server"; // Assuming '@' is aliased to 'apps/web'

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // Basic validation to ensure payload is a non-empty object
    if (!payload || typeof payload !== "object" || Object.keys(payload).length === 0) {
      return NextResponse.json(
        { error: "Invalid payload. A non-empty JSON object is required." },
        { status: 400 }
      );
    }

    const token = signAppJwt(payload, { expiresIn: "1h" });

    return NextResponse.json({ token });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body." },
        { status: 400 }
      );
    }
    
    console.error("JWT Signing Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", message: error.message },
      { status: 500 }
    );
  }
}
