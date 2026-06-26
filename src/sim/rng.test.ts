import { describe, it, expect } from "vitest";
import { Rng, mulberry32 } from "./rng";

describe("Rng", () => {
  it("ist deterministisch: gleicher Seed => identische Sequenz", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("next() liegt in [0, 1)", () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt(n) liegt in [0, n) und ist ganzzahlig", () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it("range(lo, hi) liegt in [lo, hi)", () => {
    const r = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it("fork() ist reproduzierbar und zieht aus dem Elternstrom", () => {
    const parent1 = new Rng(42);
    const parent2 = new Rng(42);
    const f1 = parent1.fork();
    const f2 = parent2.fork();
    // Gleicher Elternzustand => identische Fork-Sequenz (Reproduzierbarkeit).
    expect(Array.from({ length: 10 }, () => f1.next())).toEqual(
      Array.from({ length: 10 }, () => f2.next()),
    );
    // fork() konsumiert einen Wert -> beide Eltern liefern danach denselben nächsten Wert.
    expect(parent1.next()).toBe(parent2.next());
  });

  it("mulberry32(seed) entspricht exakt der Rng-Sequenz (eine Implementierung)", () => {
    const r = new Rng(2026);
    const fn = mulberry32(2026);
    expect(Array.from({ length: 20 }, () => fn())).toEqual(
      Array.from({ length: 20 }, () => r.next()),
    );
  });
});
