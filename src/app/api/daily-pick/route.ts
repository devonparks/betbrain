import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export async function GET() {
  const today = new Date().toISOString().split("T")[0];

  try {
    const pickDoc = await getDoc(doc(db, "dailyPicks", today));
    if (pickDoc.exists()) {
      return NextResponse.json(pickDoc.data());
    }
    return NextResponse.json(null);
  } catch {
    return NextResponse.json(null);
  }
}
