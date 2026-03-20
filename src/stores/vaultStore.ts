import { create } from "zustand";
import { persist } from "zustand/middleware";
import { VaultProp, calculateTier, calculateHitRate } from "@/lib/lock-buster";
import { ESPNPlayerGameLog } from "@/lib/stats-api";

interface VaultState {
  props: VaultProp[];
  addProp: (prop: Omit<VaultProp, "id" | "createdAt" | "tier" | "hitRate" | "avg" | "lastN">, logs: ESPNPlayerGameLog[]) => void;
  removeProp: (id: string) => void;
  updateProp: (id: string, logs: ESPNPlayerGameLog[]) => void;
  clearVault: () => void;
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set) => ({
      props: [],

      addProp: (prop, logs) => {
        const { hitRate, avg, total } = calculateHitRate(
          logs,
          prop.stat,
          prop.line,
          prop.direction
        );
        const tier = calculateTier(hitRate);
        const newProp: VaultProp = {
          ...prop,
          id: `${prop.player}-${prop.stat}-${prop.line}-${Date.now()}`,
          tier,
          hitRate,
          avg,
          lastN: total,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ props: [...state.props, newProp] }));
      },

      removeProp: (id) =>
        set((state) => ({ props: state.props.filter((p) => p.id !== id) })),

      updateProp: (id, logs) =>
        set((state) => ({
          props: state.props.map((p) => {
            if (p.id !== id) return p;
            const { hitRate, avg, total } = calculateHitRate(
              logs,
              p.stat,
              p.line,
              p.direction
            );
            return { ...p, hitRate, avg, lastN: total, tier: calculateTier(hitRate) };
          }),
        })),

      clearVault: () => set({ props: [] }),
    }),
    { name: "betbrain-vault" }
  )
);
