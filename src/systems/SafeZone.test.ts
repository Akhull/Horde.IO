import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SafeZone } from "./SafeZone";
import { CONFIG } from "../config/gameConfig";

describe("SafeZone (Zustandsautomat)", () => {
  beforeEach(() => {
    // Deterministisch: Math.random()-0.5 == 0 -> kein zufälliger Zielversatz.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("startet im 'delay'-Zustand mit Start-Radius", () => {
    const sz = new SafeZone();
    expect(sz.state).toBe("delay");
    expect(sz.current.radius).toBe(CONFIG.safeZoneStartRadius);
  });

  it("wechselt nach Ablauf der Verzögerung zu 'shrinking'", () => {
    const sz = new SafeZone();
    sz.update(CONFIG.safeZoneDelay);
    expect(sz.state).toBe("shrinking");
  });

  it("verkleinert den Radius im 'shrinking'-Zustand", () => {
    const sz = new SafeZone();
    sz.update(CONFIG.safeZoneDelay); // -> shrinking
    const before = sz.current.radius;
    sz.update(1000);
    expect(sz.current.radius).toBeLessThan(before);
  });

  it("schrumpft niemals unter den Mindestradius", () => {
    const sz = new SafeZone();
    sz.update(CONFIG.safeZoneDelay);
    for (let i = 0; i < 10000; i++) sz.update(1000);
    expect(sz.current.radius).toBeGreaterThanOrEqual(CONFIG.safeZoneMinRadius - 1e-6);
  });
});
