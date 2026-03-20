import { create } from "zustand";
import { SportKey, UserProfile } from "@/lib/types";

interface UserState {
  user: UserProfile | null;
  isLoading: boolean;
  selectedSport: SportKey;
  selectedBook: string; // "best" or specific book key
  setUser: (user: UserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  setSport: (sport: SportKey) => void;
  setBook: (book: string) => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  isLoading: true,
  selectedSport: "nba",
  selectedBook: "best",

  setUser: (user) => set({ user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  setSport: (selectedSport) => set({ selectedSport }),
  setBook: (selectedBook) => set({ selectedBook }),
}));
