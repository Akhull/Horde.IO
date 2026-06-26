import { describe, it, expect } from "vitest";
import { buildScaledPersonalities } from "./difficulty";
import { AI, DIFFICULTY } from "../config/gameConfig";
import type { AIPersonality } from "../config/gameConfig";

// Tiefe Kopie der Basis-Persönlichkeiten als Referenz, um Mutation zu erkennen.
const baseSnapshot = structuredClone(AI.personalities);

describe("buildScaledPersonalities (Schwierigkeits-Skalierung)", () => {
  it("liefert für 'normal' (Faktoren 1.0) die unveränderten Basiswerte", () => {
    const scaled = buildScaledPersonalities("normal");
    for (const key of Object.keys(AI.personalities) as AIPersonality[]) {
      const base = AI.personalities[key];
      expect(scaled[key].aggroRange).toBeCloseTo(base.aggroRange);
      expect(scaled[key].soulGreed).toBeCloseTo(base.soulGreed);
      expect(scaled[key].finishHpRatio).toBeCloseTo(base.finishHpRatio);
    }
  });

  it("erhöht Aggro-Reichweite und Finish-Schwelle bei 'schwer'", () => {
    const scaled = buildScaledPersonalities("schwer");
    const f = DIFFICULTY.schwer.aiAggression;
    const base = AI.personalities.balanced;
    expect(scaled.balanced.aggroRange).toBeCloseTo(base.aggroRange * f);
    expect(scaled.balanced.finishHpRatio).toBeCloseTo(base.finishHpRatio * f);
    // Flieht später (retreatHpFactor sinkt mit mehr Aggression).
    expect(scaled.balanced.retreatHpFactor).toBeLessThan(base.retreatHpFactor);
  });

  it("senkt Aggro-Reichweite bei 'leicht'", () => {
    const scaled = buildScaledPersonalities("leicht");
    const base = AI.personalities.aggressive;
    expect(scaled.aggressive.aggroRange).toBeLessThan(base.aggroRange);
  });

  it("klemmt Wahrscheinlichkeiten/Faktoren auf [0,1] (z.B. soulGreed bei Hardcore)", () => {
    const scaled = buildScaledPersonalities("hardcore");
    for (const key of Object.keys(scaled) as AIPersonality[]) {
      expect(scaled[key].soulGreed).toBeGreaterThanOrEqual(0);
      expect(scaled[key].soulGreed).toBeLessThanOrEqual(1);
      expect(scaled[key].finishHpRatio).toBeLessThanOrEqual(1);
      expect(scaled[key].retreatHpFactor).toBeLessThanOrEqual(1);
      expect(scaled[key].regroupHpFactor).toBeLessThanOrEqual(1);
    }
  });

  it("mutiert die `as const`-Basiskonstanten NICHT (keine Leaks zwischen Runden)", () => {
    buildScaledPersonalities("hardcore");
    buildScaledPersonalities("leicht");
    buildScaledPersonalities("schwer");
    expect(AI.personalities).toEqual(baseSnapshot);
  });

  it("liefert bei jedem Aufruf frische Objekte (keine geteilten Referenzen)", () => {
    const a = buildScaledPersonalities("normal");
    const b = buildScaledPersonalities("normal");
    expect(a.balanced).not.toBe(b.balanced);
    a.balanced.aggroRange = 9999;
    expect(b.balanced.aggroRange).not.toBe(9999);
  });
});
