// Deterministischer, geseedeter PRNG für den Simulations-Kern.
//
// Gleicher Seed + gleiche Aufruf-Sequenz => identische Werte über Maschinen hinweg.
// Das ist die Grundlage für den server-autoritativen / lockstep-fähigen Multiplayer:
// Server und Client können denselben Tick reproduzieren. WICHTIG: Im Sim-Kern
// (src/sim/**) NIE Math.random()/Date.now() nutzen — stattdessen eine Rng-Instanz
// durchfädeln. Rein visuelle/FX-Zufälligkeit (Partikel, Shake) darf lokal bleiben.

// mulberry32: kleiner, schneller 32-Bit-PRNG. next() liefert Werte in [0, 1).
// Der Algorithmus ist byte-identisch zur bisherigen Definition in tools/bench/shared.ts
// (die jetzt von hier re-exportiert) — sonst änderte sich die Benchmark-Welt.
export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  // Float in [0, 1).
  next(): number {
    this.a |= 0;
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Ganzzahl in [0, n).
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }

  // Float in [lo, hi).
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  // Leitet einen unabhängigen Teilstrom ab (z. B. ein Rng pro System), ohne dass
  // sich die Ströme gegenseitig stören. Deterministisch: gleicher Elternzustand
  // => gleicher Fork. Zieht EINEN Wert aus diesem Strom als Fork-Seed.
  fork(): Rng {
    return new Rng((this.next() * 4294967296) >>> 0);
  }
}

// Freie-Funktions-Form mit der bisherigen mulberry32-Signatur (() => number).
// Existiert, damit Aufrufer, die nur eine Zufallsfunktion brauchen (z. B. der
// Benchmark), DIESELBE Implementierung teilen — eine einzige Quelle der Wahrheit.
export function mulberry32(seed: number): () => number {
  const rng = new Rng(seed);
  return () => rng.next();
}
