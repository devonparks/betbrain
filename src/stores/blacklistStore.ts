import { create } from "zustand";
import { persist } from "zustand/middleware";

interface BlacklistState {
  players: string[];
  addPlayer: (name: string) => void;
  removePlayer: (name: string) => void;
  isBlacklisted: (name: string) => boolean;
  clearAll: () => void;
}

export const useBlacklistStore = create<BlacklistState>()(
  persist(
    (set, get) => ({
      players: [],

      addPlayer: (name) =>
        set((state) => ({
          players: state.players.includes(name)
            ? state.players
            : [...state.players, name],
        })),

      removePlayer: (name) =>
        set((state) => ({
          players: state.players.filter((p) => p !== name),
        })),

      isBlacklisted: (name) => get().players.includes(name),

      clearAll: () => set({ players: [] }),
    }),
    { name: "betbrain-blacklist" }
  )
);
