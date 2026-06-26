import { describe, it, expect } from "vitest";
import { SafeZone } from "./SafeZone";
import { CONFIG } from "../config/gameConfig";
import { Rng } from "../sim/rng";

describe("SafeZone (Zustandsautomat)", () => {
  it("startet im 'delay'-Zustand mit Start-Radius", () => {
    const sz = new SafeZone(new Rng(1));
    expect(sz.state).toBe("delay");
    expect(sz.current.radius).toBe(CONFIG.safeZoneStartRadius);
  });

  it("wechselt nach Ablauf der Verzögerung zu 'shrinking'", () => {
    const sz = new SafeZone(new Rng(1));
    sz.update(CONFIG.safeZoneDelay);
    expect(sz.state).toBe("shrinking");
  });

  it("verkleinert den Radius im 'shrinking'-Zustand", () => {
    const sz = new SafeZone(new Rng(1));
    sz.update(CONFIG.safeZoneDelay); // -> shrinking
    const before = sz.current.radius;
    sz.update(1000);
    expect(sz.current.radius).toBeLessThan(before);
  });

  it("schrumpft niemals unter den Mindestradius", () => {
    const sz = new SafeZone(new Rng(1));
    sz.update(CONFIG.safeZoneDelay);
    for (let i = 0; i < 10000; i++) sz.update(1000);
    expect(sz.current.radius).toBeGreaterThanOrEqual(CONFIG.safeZoneMinRadius - 1e-6);
  });

  it("ist deterministisch: gleicher Seed => identischer Zonenpfad", () => {
    // Treibt die Zone durch shrink/pause/move (alle rng-Stellen) und vergleicht zwei
    // Läufe mit gleichem Seed -> exakt gleich. Das ist die Multiplayer-Kerneigenschaft.
    const run = () => {
      const sz = new SafeZone(new Rng(777));
      for (let i = 0; i < 5000; i++) sz.update(100);
      return { ...sz.current, state: sz.state };
    };
    expect(run()).toEqual(run());
  });
});
