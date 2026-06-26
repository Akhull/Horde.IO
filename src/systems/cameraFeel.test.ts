import { describe, it, expect } from "vitest";
import {
  clamp01,
  lerp,
  frameLerpAlpha,
  battlePhaseFactor,
  clashIntensity,
  battleShakeAmplitude,
  warAmbienceTarget,
} from "./cameraFeel";
import { BATTLE_ESCALATION } from "../config/gameConfig";

describe("clamp01 / lerp (Basis-Helfer)", () => {
  it("clamp01 klemmt auf [0,1]", () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0.3)).toBe(0.3);
    expect(clamp01(5)).toBe(1);
  });

  it("lerp interpoliert linear", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});

describe("frameLerpAlpha (frame-raten-unabhängige Glättung)", () => {
  it("liefert bei 16.67ms genau den per16-Anteil", () => {
    expect(frameLerpAlpha(16.6667, 0.16)).toBeCloseTo(0.16, 4);
  });

  it("zieht bei längeren Frames stärker nach (gleich 'schnelle' Glättung)", () => {
    const short = frameLerpAlpha(16.6667, 0.16);
    const long = frameLerpAlpha(33.3334, 0.16);
    expect(long).toBeGreaterThan(short);
    // Zwei halbe Schritte ergeben denselben Restanteil wie ein voller langer Schritt.
    expect(1 - long).toBeCloseTo((1 - short) ** 2, 6);
  });

  it("klemmt degenerierte per16-Werte", () => {
    expect(frameLerpAlpha(16, 0)).toBe(0);
    expect(frameLerpAlpha(16, 1)).toBe(1);
  });
});

describe("battlePhaseFactor (ruhiger Start -> episches Finale)", () => {
  const { earlyKings, finalKings } = BATTLE_ESCALATION;

  it("ist 0 in der Frühphase (>= earlyKings Könige)", () => {
    expect(battlePhaseFactor(earlyKings, earlyKings, finalKings)).toBe(0);
    expect(battlePhaseFactor(11, earlyKings, finalKings)).toBe(0);
  });

  it("ist 1 im Finale (<= finalKings Könige)", () => {
    expect(battlePhaseFactor(finalKings, earlyKings, finalKings)).toBe(1);
    expect(battlePhaseFactor(1, earlyKings, finalKings)).toBe(1);
  });

  it("steigt monoton, je weniger Könige leben", () => {
    let prev = -1;
    for (let k = earlyKings; k >= finalKings; k--) {
      const p = battlePhaseFactor(k, earlyKings, finalKings);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("liegt immer in [0,1]", () => {
    for (let k = 0; k <= 20; k++) {
      const p = battlePhaseFactor(k, earlyKings, finalKings);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("clashIntensity (Gate auf echtes Gemetzel)", () => {
  const { clashThreshold, clashRange } = BATTLE_ESCALATION;

  it("ist 0 bis zum Schwellwert (kein Kampf -> kein Shake)", () => {
    expect(clashIntensity(0, clashThreshold, clashRange)).toBe(0);
    expect(clashIntensity(clashThreshold, clashThreshold, clashRange)).toBe(0);
  });

  it("rampt linear bis 1 bei threshold+range", () => {
    expect(clashIntensity(clashThreshold + clashRange / 2, clashThreshold, clashRange)).toBeCloseTo(0.5);
    expect(clashIntensity(clashThreshold + clashRange, clashThreshold, clashRange)).toBe(1);
    expect(clashIntensity(clashThreshold + clashRange * 3, clashThreshold, clashRange)).toBe(1);
  });
});

describe("battleShakeAmplitude (Phase × Clash)", () => {
  const { baselineShakePx, epicShakePx } = BATTLE_ESCALATION;

  it("ist 0 ohne Clash – selbst im Finale wackelt nichts ohne Kampf", () => {
    expect(battleShakeAmplitude(1, 0, baselineShakePx, epicShakePx)).toBe(0);
  });

  it("liefert die Baseline-Spitze in der Frühphase bei vollem Clash", () => {
    expect(battleShakeAmplitude(0, 1, baselineShakePx, epicShakePx)).toBeCloseTo(baselineShakePx);
  });

  it("liefert die epische Spitze im Finale bei vollem Clash", () => {
    expect(battleShakeAmplitude(1, 1, baselineShakePx, epicShakePx)).toBeCloseTo(epicShakePx);
  });

  it("ist im Finale stärker als in der Frühphase (bei gleichem Clash)", () => {
    const early = battleShakeAmplitude(0, 1, baselineShakePx, epicShakePx);
    const final = battleShakeAmplitude(1, 1, baselineShakePx, epicShakePx);
    expect(final).toBeGreaterThan(early);
  });
});

describe("warAmbienceTarget (Schlacht-Musik schwillt zum Finale an)", () => {
  it("ist im Finale lauter als in der Frühphase bei gleicher Kampflage", () => {
    const early = warAmbienceTarget(20, 80, 0, BATTLE_ESCALATION);
    const final = warAmbienceTarget(20, 80, 1, BATTLE_ESCALATION);
    expect(final).toBeGreaterThan(early);
  });

  it("respektiert die Frühphasen-Decke (ruhiger Start)", () => {
    // Maximale Kampflage in Phase 0 darf die early-Decke nicht überschreiten.
    expect(warAmbienceTarget(9999, 9999, 0, BATTLE_ESCALATION)).toBeCloseTo(BATTLE_ESCALATION.ambienceEarlyCeiling);
  });

  it("erreicht im Finale annähernd die finale Decke bei voller Kampflage", () => {
    expect(warAmbienceTarget(9999, 9999, 1, BATTLE_ESCALATION)).toBeCloseTo(BATTLE_ESCALATION.ambienceFinalCeiling);
  });

  it("bleibt in [0,1]", () => {
    expect(warAmbienceTarget(0, 0, 0, BATTLE_ESCALATION)).toBe(0);
    expect(warAmbienceTarget(9999, 9999, 1, BATTLE_ESCALATION)).toBeLessThanOrEqual(1);
  });
});
