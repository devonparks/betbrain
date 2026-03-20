import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export async function GET(req: NextRequest) {
  const date =
    req.nextUrl.searchParams.get("date") ??
    new Date(Date.now() - 86400000).toISOString().split("T")[0]; // Yesterday

  try {
    const recapDoc = await getDoc(doc(db, "recaps", date));
    if (recapDoc.exists()) {
      return NextResponse.json(recapDoc.data());
    }
    return NextResponse.json(null);
  } catch {
    return NextResponse.json(null);
  }
}
