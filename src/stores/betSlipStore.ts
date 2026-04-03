import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BetRecommendation } from "@/lib/types";
import { calculateParlayOdds, calculatePayout, formatOdds } from "@/lib/utils";

interface BetSlipState {
  legs: BetRecommendation[];
  stake: number;
  isOpen: boolean;
  addLeg: (leg: BetRecommendation) => void;
  removeLeg: (index: number) => void;
  clearSlip: () => void;
  setStake: (stake: number) => void;
  toggleSlip: () => void;
  getCombinedOdds: () => string;
  getPayout: () => number;
}

export const useBetSlipStore = create<BetSlipState>()(
  persist(
    (set, get) => ({
      legs: [],
      stake: 10,
      isOpen: false,

      addLeg: (leg) =>
        set((state) => ({
          legs: [...state.legs, leg],
          isOpen: true,
        })),

      removeLeg: (index) =>
        set((state) => ({
          legs: state.legs.filter((_, i) => i !== index),
        })),

      clearSlip: () => set({ legs: [], stake: 10 }),

      setStake: (stake) => set({ stake }),

      toggleSlip: () => set((state) => ({ isOpen: !state.isOpen })),

      getCombinedOdds: () => {
        const { legs } = get();
        if (legs.length === 0) return "+0";
        if (legs.length === 1) return legs[0].bestOdds;
        const odds = legs.map((l) => parseInt(l.bestOdds));
        return formatOdds(calculateParlayOdds(odds));
      },

      getPayout: () => {
        const { legs, stake } = get();
        if (legs.length === 0) return 0;
        if (legs.length === 1) return calculatePayout(stake, parseInt(legs[0].bestOdds));
        const odds = legs.map((l) => parseInt(l.bestOdds));
        return calculatePayout(stake, calculateParlayOdds(odds));
      },
    }),
    { name: "betbrain-betslip" }
  )
);
