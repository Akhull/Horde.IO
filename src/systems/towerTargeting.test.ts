import { describe, it, expect } from "vitest";
import { pickTowerTarget, type TowerTargetCandidate } from "./towerTargeting";

// Hilfskonstruktor für Test-Kandidaten.
const c = (centerX: number, centerY: number, hp = 100, dead = false): TowerTargetCandidate => ({
  centerX,
  centerY,
  hp,
  dead,
});

describe("pickTowerTarget (Turm-Zielwahl)", () => {
  it("gibt null zurück, wenn keine Kandidaten existieren", () => {
    expect(pickTowerTarget(0, 0, [], 260)).toBeNull();
  });

  it("ignoriert Ziele ausserhalb der Reichweite", () => {
    expect(pickTowerTarget(0, 0, [c(500, 0)], 260)).toBeNull();
  });

  it("wählt das nächstgelegene Ziel in Reichweite", () => {
    const near = c(100, 0);
    const far = c(200, 0);
    expect(pickTowerTarget(0, 0, [far, near], 260)).toBe(near);
  });

  it("überspringt tote Ziele", () => {
    const dead = c(50, 0, 100, true);
    const alive = c(150, 0);
    expect(pickTowerTarget(0, 0, [dead, alive], 260)).toBe(alive);
  });

  it("überspringt Ziele ohne HP", () => {
    const noHp = c(50, 0, 0);
    const alive = c(150, 0);
    expect(pickTowerTarget(0, 0, [noHp, alive], 260)).toBe(alive);
  });

  it("behandelt die Reichweite exklusiv (genau auf der Grenze zählt nicht)", () => {
    expect(pickTowerTarget(0, 0, [c(260, 0)], 260)).toBeNull();
    expect(pickTowerTarget(0, 0, [c(259, 0)], 260)).not.toBeNull();
  });
});
