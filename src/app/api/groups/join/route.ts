import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

export async function POST(req: NextRequest) {
  try {
    const { groupId, userId, displayName } = await req.json();

    if (!groupId || !userId) {
      return NextResponse.json(
        { error: "groupId and userId are required" },
        { status: 400 }
      );
    }

    const groupRef = doc(db, "groups", groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const groupData = groupSnap.data();
    const memberCount = Object.keys(groupData.members ?? {}).length;
    const maxMembers = groupData.settings?.maxMembers ?? 25;

    if (memberCount >= maxMembers) {
      return NextResponse.json({ error: "Group is full" }, { status: 400 });
    }

    // Add user to members
    await updateDoc(groupRef, {
      [`members.${userId}`]: {
        displayName: displayName ?? "Member",
        role: "member",
        joinedAt: new Date(),
      },
    });

    const updatedSnap = await getDoc(groupRef);
    return NextResponse.json({ id: groupId, ...updatedSnap.data() });
  } catch (err) {
    console.error("Join group error:", err);
    return NextResponse.json(
      { error: "Failed to join group" },
      { status: 500 }
    );
  }
}
