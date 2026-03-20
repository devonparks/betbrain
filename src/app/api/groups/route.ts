import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
} from "firebase/firestore";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  const inviteCode = req.nextUrl.searchParams.get("inviteCode");

  try {
    if (inviteCode) {
      const q = query(
        collection(db, "groups"),
        where("inviteCode", "==", inviteCode)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }
      return NextResponse.json({ id: snap.docs[0].id, ...snap.docs[0].data() });
    }

    if (userId) {
      // Get groups where user is a member
      const q = query(collection(db, "groups"));
      const snap = await getDocs(q);
      const userGroups = snap.docs
        .filter((d) => d.data().members?.[userId])
        .map((d) => ({ id: d.id, ...d.data() }));
      return NextResponse.json(userGroups);
    }

    return NextResponse.json([]);
  } catch (err) {
    console.error("Groups error:", err);
    return NextResponse.json(
      { error: "Failed to fetch groups" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, createdBy, displayName } = body;

    if (!name || !createdBy) {
      return NextResponse.json(
        { error: "name and createdBy are required" },
        { status: 400 }
      );
    }

    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const groupRef = doc(collection(db, "groups"));
    const groupData = {
      name,
      createdBy,
      members: {
        [createdBy]: {
          displayName: displayName ?? "Owner",
          role: "owner",
          joinedAt: new Date(),
        },
      },
      inviteCode,
      settings: { maxMembers: 25, isPublic: false },
    };

    await setDoc(groupRef, groupData);
    return NextResponse.json({ id: groupRef.id, ...groupData });
  } catch (err) {
    console.error("Create group error:", err);
    return NextResponse.json(
      { error: "Failed to create group" },
      { status: 500 }
    );
  }
}
