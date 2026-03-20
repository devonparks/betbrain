"use client";

import { useEffect } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserStore } from "@/stores/userStore";
import { UserProfile } from "@/lib/types";

const googleProvider = new GoogleAuthProvider();

export function useAuth() {
  const { user, isLoading, setUser, setLoading } = useUserStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const profile = await getOrCreateProfile(firebaseUser);
        setUser(profile);
      } else {
        setUser(null);
      }
    });
    return unsubscribe;
  }, [setUser]);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    setLoading(true);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      displayName,
      email,
      preferences: {
        favoriteSports: ["nba"],
        defaultBook: "best",
        notifications: {
          lineupAlerts: true,
          oddsMovement: true,
          dailyPick: true,
          groupActivity: true,
        },
      },
      betHistory: [],
      savedParlays: [],
      record: { wins: 0, losses: 0, pushes: 0, units: 0, roi: 0 },
      groups: [],
    });
  };

  const signInWithGoogle = async () => {
    setLoading(true);
    await signInWithPopup(auth, googleProvider);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
  };

  return { user, isLoading, signIn, signUp, signInWithGoogle, signOut };
}

async function getOrCreateProfile(firebaseUser: User): Promise<UserProfile> {
  const ref = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data() as UserProfile;
  }
  const profile: UserProfile = {
    uid: firebaseUser.uid,
    displayName: firebaseUser.displayName ?? "Bettor",
    email: firebaseUser.email ?? "",
    preferences: {
      favoriteSports: ["nba"],
      defaultBook: "best",
      notifications: {
        lineupAlerts: true,
        oddsMovement: true,
        dailyPick: true,
        groupActivity: true,
      },
    },
    betHistory: [],
    savedParlays: [],
    record: { wins: 0, losses: 0, pushes: 0, units: 0, roi: 0 },
    groups: [],
  };
  await setDoc(ref, profile);
  return profile;
}
