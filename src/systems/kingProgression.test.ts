import { describe, it, expect } from "vitest";
import { kingDamageMult, kingSizeMult, kingDisplaySize, applyKingXp } from "./kingProgression";
import { KING_PROGRESSION, UNIT_STATS } from "../config/gameConfig";

describe("applyKingXp (Seelen-XP -> Königs-Stufe)", () => {
  it("levelt von L1 mit genau der Schwelle auf L2 (0 Rest)", () => {
    // xpToNext[1] ist die XP-Menge bis L2; sie exakt zu sammeln hebt eine Stufe ohne Übertrag.
    const need = KING_PROGRESSION.xpToNext[1];
    const r = applyKingXp(1, 0, need);
    expect(r.level).toBe(2);
    expect(r.xp).toBe(0);
    expect(r.levelsGained).toBe(1);
  });

  it("bleibt unter der Schwelle auf L1 und bankt die XP", () => {
    const under = KING_PROGRESSION.xpToNext[1] - 1;
    const r = applyKingXp(1, 0, under);
    expect(r.level).toBe(1);
    expect(r.xp).toBe(under);
    expect(r.levelsGained).toBe(0);
  });

  it("überspringt bei genug XP in EINEM Schritt mehrere Stufen (L1 -> L3, 0 Rest)", () => {
    // Summe der Schwellen für L2 und L3 zusammen -> genau zwei Stufen, kein Rest.
    const need = KING_PROGRESSION.xpToNext[1] + KING_PROGRESSION.xpToNext[2];
    const r = applyKingXp(1, 0, need);
    expect(r.level).toBe(3);
    expect(r.xp).toBe(0);
    expect(r.levelsGained).toBe(2);
  });

  it("zählt levelsGained für einen Mehr-Stufen-Sprung korrekt", () => {
    // Genug XP für L2 + L3 plus etwas Übertrag, der unter L4-Schwelle bleibt.
    const need = KING_PROGRESSION.xpToNext[1] + KING_PROGRESSION.xpToNext[2] + 3;
    const r = applyKingXp(1, 0, need);
    expect(r.level).toBe(3);
    expect(r.levelsGained).toBe(2);
    expect(r.xp).toBe(3);
  });

  it("deckelt bei riesigem XP-Schub auf maxLevel und STOPPT das Verbrauchen (Rest akkumuliert)", () => {
    // 200 XP von L1: levelt bis maxLevel und bankt den nicht mehr verbrauchbaren Überschuss.
    const r = applyKingXp(1, 0, 200);
    expect(r.level).toBe(KING_PROGRESSION.maxLevel);
    expect(r.levelsGained).toBe(KING_PROGRESSION.maxLevel - 1);
    // Verbrauchte XP = Summe aller Schwellen bis maxLevel; der Rest muss übrig sein.
    let consumed = 0;
    for (let l = 1; l < KING_PROGRESSION.maxLevel; l++) consumed += KING_PROGRESSION.xpToNext[l];
    expect(r.xp).toBe(200 - consumed);
    expect(r.xp).toBeGreaterThan(0);
  });

  it("bankt auf maxLevel weiter XP, levelt aber nie (kein Out-of-Bounds auf xpToNext)", () => {
    const r = applyKingXp(KING_PROGRESSION.maxLevel, 4, 50);
    expect(r.level).toBe(KING_PROGRESSION.maxLevel);
    expect(r.levelsGained).toBe(0);
    expect(r.xp).toBe(54); // alter Rest + amount, unverändert gebankt
    expect(Number.isFinite(r.xp)).toBe(true); // kein NaN durch xpToNext[maxLevel] (undefined)
  });
});

describe("kingDamageMult (Stufen-Schadensbonus)", () => {
  it("ist auf L1 neutral (1.0, kein Buff)", () => {
    expect(kingDamageMult(1)).toBe(1);
  });

  it("ist auf maxLevel 1 + (maxLevel-1)*damageMultPerLevel (an Config gekoppelt)", () => {
    const expected = 1 + (KING_PROGRESSION.maxLevel - 1) * KING_PROGRESSION.damageMultPerLevel;
    expect(kingDamageMult(KING_PROGRESSION.maxLevel)).toBeCloseTo(expected, 10);
  });

  it("wächst streng monoton mit der Stufe", () => {
    let prev = -Infinity;
    for (let l = 1; l <= KING_PROGRESSION.maxLevel; l++) {
      const m = kingDamageMult(l);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });

  it("klemmt degenerierte Stufen defensiv auf >= 1", () => {
    expect(kingDamageMult(0)).toBe(1);
    expect(kingDamageMult(-5)).toBe(1);
  });
});

describe("kingSizeMult / kingDisplaySize (gedeckeltes Größenwachstum)", () => {
  it("ist auf L1 neutral (Faktor 1, Basisgröße)", () => {
    expect(kingSizeMult(1)).toBe(1);
    expect(kingDisplaySize(1)).toBe(UNIT_STATS.king.size);
  });

  it("ist monoton nicht-fallend über alle Stufen", () => {
    let prev = -Infinity;
    for (let l = 1; l <= KING_PROGRESSION.maxLevel; l++) {
      const m = kingSizeMult(l);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it("erreicht auf maxLevel das ungekappte Wachstum (Cap bindet HIER NICHT, s. Sanity-Block)", () => {
    // HINWEIS: Mit der ausgelieferten Config (maxLevel 6, sizeMultPerLevel 0.05) ergibt das
    // Wachstum auf der Höchststufe 1 + 5*0.05 = 1.25 und liegt UNTER maxSizeMult (1.3). Der Cap
    // ist also reine Kopf-Reserve und greift erst, wenn maxLevel angehoben würde. Wir koppeln den
    // Erwartungswert an die Config, damit der Test eine reine Balance-Tweak ÜBERLEBT.
    const uncapped = 1 + (KING_PROGRESSION.maxLevel - 1) * KING_PROGRESSION.sizeMultPerLevel;
    expect(kingSizeMult(KING_PROGRESSION.maxLevel)).toBeCloseTo(Math.min(KING_PROGRESSION.maxSizeMult, uncapped), 10);
  });

  it("überschreitet die Deckelung nie, selbst weit über maxLevel hinaus (Cap greift dort hart)", () => {
    // Weit jenseits von maxLevel würde das lineare Wachstum maxSizeMult überschreiten -> der
    // Math.min-Cap MUSS hier binden. So ist die Deckelungs-Logik selbst abgesichert, unabhängig
    // davon, ob sie auf der aktuellen Höchststufe bereits greift.
    expect(kingSizeMult(999)).toBe(KING_PROGRESSION.maxSizeMult);
    expect(kingDisplaySize(999)).toBeCloseTo(UNIT_STATS.king.size * KING_PROGRESSION.maxSizeMult, 6);
  });
});

describe("Konfig-Sanity / Regression (Invarianten der König-Progression)", () => {
  it("xpToNext deckt Indizes 0..maxLevel-1 ab (Index 0 ungenutzt)", () => {
    // Die Schleife liest xpToNext[level] für level 1..maxLevel-1; die Länge muss das tragen.
    expect(KING_PROGRESSION.xpToNext.length).toBe(KING_PROGRESSION.maxLevel);
    expect(KING_PROGRESSION.xpToNext[0]).toBe(0); // Stufe 0 existiert nicht -> Slot bleibt 0
    for (let l = 1; l < KING_PROGRESSION.maxLevel; l++) {
      expect(KING_PROGRESSION.xpToNext[l]).toBeGreaterThan(0);
    }
  });

  it("xpPerSoul hat einen Eintrag für alle 4 Seelen-Typen", () => {
    const types = Object.keys(KING_PROGRESSION.xpPerSoul);
    expect(types.sort()).toEqual(["blue", "gold", "green", "purple"]);
    for (const t of types) {
      expect(KING_PROGRESSION.xpPerSoul[t as keyof typeof KING_PROGRESSION.xpPerSoul]).toBeGreaterThan(0);
    }
  });

  it("dokumentiert: der Größen-Cap BINDET mit der aktuellen Config NICHT auf maxLevel (Kopf-Reserve)", () => {
    // Bewusste Regression-Doku statt einer Behauptung: mit den ausgelieferten Werten liegt das
    // ungekappte Wachstum auf der Höchststufe UNTER maxSizeMult, der Cap greift dort also (noch)
    // nicht. Er ist als Sicherheitsnetz für ein späteres Anheben von maxLevel/sizeMultPerLevel da.
    // Bricht diese Annahme (z. B. maxLevel hochgezogen, sodass der Cap plötzlich bindet), schlägt
    // dieser Test bewusst an -> dann ist der "Cap bindet"-Test darüber zu schärfen.
    const uncapped = 1 + (KING_PROGRESSION.maxLevel - 1) * KING_PROGRESSION.sizeMultPerLevel;
    expect(uncapped).toBeLessThanOrEqual(KING_PROGRESSION.maxSizeMult);
    expect(kingSizeMult(KING_PROGRESSION.maxLevel)).toBe(uncapped);
    // maxSizeMult muss aber >= dem ungekappten Wachstum bleiben (Cap darf das Wachstum nie unter
    // den vorgesehenen Höchstwert drücken) – die eigentliche Invariante, die wir schützen.
    expect(KING_PROGRESSION.maxSizeMult).toBeGreaterThanOrEqual(uncapped);
  });
});
