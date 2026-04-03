import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, arrayUnion } from "firebase/firestore";

// Track a new bet
export async function POST(req: NextRequest) {
  try {
    const { userId, bet } = await req.json();
    if (!userId || typeof userId !== "string" || userId.length > 128) {
      return NextResponse.json(
        { error: "userId must be a non-empty string (max 128 chars)" },
        { status: 400 }
      );
    }
    if (!bet || typeof bet !== "object" || typeof bet.pick !== "string") {
      return NextResponse.json(
        { error: "bet must be an object with at minimum a 'pick' string property" },
        { status: 400 }
      );
    }

    const betRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: new Date().toISOString().split("T")[0],
      bet,
      stake: bet.stake ?? 1,
      result: "pending",
      payout: 0,
    };

    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      betHistory: arrayUnion(betRecord),
    });

    return NextResponse.json(betRecord);
  } catch (err) {
    console.error("Track bet error:", err);
    return NextResponse.json(
      { error: "Failed to track bet" },
      { status: 500 }
    );
  }
}

// Update bet result (W/L/Push)
export async function PATCH(req: NextRequest) {
  try {
    const { userId, betId, result } = await req.json();
    if (!userId || typeof userId !== "string" || userId.length > 128) {
      return NextResponse.json(
        { error: "userId must be a non-empty string (max 128 chars)" },
        { status: 400 }
      );
    }
    if (!betId || typeof betId !== "string" || betId.length > 64) {
      return NextResponse.json(
        { error: "betId must be a non-empty string (max 64 chars)" },
        { status: 400 }
      );
    }
    if (!["won", "lost", "push"].includes(result)) {
      return NextResponse.json(
        { error: "result must be one of: won, lost, push" },
        { status: 400 }
      );
    }

    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userData = userSnap.data();
    const betHistory = (userData.betHistory ?? []).map(
      (b: { id: string; result: string; stake: number }) => {
        if (b.id === betId) {
          return {
            ...b,
            result,
            payout: result === "won" ? b.stake * 2 : 0,
          };
        }
        return b;
      }
    );

    // Recalculate record
    const wins = betHistory.filter(
      (b: { result: string }) => b.result === "won"
    ).length;
    const losses = betHistory.filter(
      (b: { result: string }) => b.result === "lost"
    ).length;
    const pushes = betHistory.filter(
      (b: { result: string }) => b.result === "push"
    ).length;
    const units = betHistory.reduce(
      (
        acc: number,
        b: { result: string; stake: number }
      ) => {
        if (b.result === "won") return acc + b.stake;
        if (b.result === "lost") return acc - b.stake;
        return acc;
      },
      0
    );

    await updateDoc(userRef, {
      betHistory,
      record: {
        wins,
        losses,
        pushes,
        units,
        roi: wins + losses > 0 ? (units / (wins + losses)) * 100 : 0,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Update bet error:", err);
    return NextResponse.json(
      { error: "Failed to update bet" },
      { status: 500 }
    );
  }
}
