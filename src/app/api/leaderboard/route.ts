import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";

export async function GET() {
  try {
    // Get AI record from Firestore
    const aiDoc = await getDocs(collection(db, "aiPerformance"));
    let aiRecord = {
      wins: 0,
      losses: 0,
      pushes: 0,
      units: 0,
      winRate: 0,
    };
    if (!aiDoc.empty) {
      const data = aiDoc.docs[0].data();
      aiRecord = {
        wins: data.wins ?? 0,
        losses: data.losses ?? 0,
        pushes: data.pushes ?? 0,
        units: data.units ?? 0,
        winRate:
          data.wins + data.losses > 0
            ? data.wins / (data.wins + data.losses)
            : 0,
      };
    }

    // Get top users by units
    const usersQuery = query(
      collection(db, "users"),
      orderBy("record.units", "desc"),
      limit(20)
    );
    const usersSnap = await getDocs(usersQuery);
    const topUsers = usersSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        uid: doc.id,
        displayName: d.displayName ?? "Anonymous",
        record: d.record ?? { wins: 0, losses: 0, pushes: 0, units: 0 },
      };
    });

    return NextResponse.json({ aiRecord, topUsers });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return NextResponse.json({ aiRecord: null, topUsers: [] });
  }
}
