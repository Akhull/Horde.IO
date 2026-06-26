// Reine, Phaser-freie König-Progressions-Mathematik. Der KÖNIG selbst levelt aus eingesammelten
// Seelen (mehr HP, härtere Schläge, leicht größere Figur) – symmetrisch für Spieler- UND KI-König.
// Bislang lag dieser Kern als inline-Schleife/-Ausdrücke in der Phaser-gekoppelten Unit-Klasse und
// war damit nicht isoliert testbar. Hier liegen nur die deterministischen Skalar-/Schwellen-Kurven
// (keine Tweens, kein Scene-State), damit die Königs-Math ohne Browser-Umgebung testbar bleibt.
// Die Buffs werden bewusst read-time aus kingLevel berechnet (kein State-Leak, kein Float-Drift):
// Größe wird IMMER aus dem BASIS-Wert UNIT_STATS.king.size neu skaliert statt kompoundiert.

import { KING_PROGRESSION, UNIT_STATS } from "../config/gameConfig";

// Nahkampf-Schadensmultiplikator des Königs aus seiner Stufe: +damageMultPerLevel je Stufe über
// Stufe 1 (L1 => 1.0, kein Buff). Read-time gelesen (wie die Power-Up-Mults), damit ein Level-up
// sofort greift. kingLevel >= 1 wird defensiv geklemmt, damit ein degenerierter 0/negativer Wert
// den Mult nicht unter 1 drückt (maxLevel deckelt das obere Ende ohnehin über die Schwellenkurve).
export function kingDamageMult(kingLevel: number): number {
  const lvl = Math.max(1, kingLevel);
  return 1 + (lvl - 1) * KING_PROGRESSION.damageMultPerLevel;
}

// GEDECKELTER Größen-Wachstumsfaktor des Königs aus seiner Stufe: +sizeMultPerLevel je Stufe über
// Stufe 1, hart begrenzt auf maxSizeMult. Die Deckelung ist Absicht – der König darf optisch wachsen
// (Belohnung), aber das Feld nicht erdrücken / unlesbar werden. kingLevel >= 1 defensiv geklemmt.
export function kingSizeMult(kingLevel: number): number {
  const lvl = Math.max(1, kingLevel);
  return Math.min(KING_PROGRESSION.maxSizeMult, 1 + (lvl - 1) * KING_PROGRESSION.sizeMultPerLevel);
}

// Konkrete Anzeigegröße (setDisplaySize) des Königs auf einer Stufe: BASIS-Größe × gedeckelter
// Wachstumsfaktor. Bewusst aus dem BASIS-Wert neu berechnet statt zu kompoundieren, damit kein
// Float-Drift über viele Level-ups entsteht (L1 ergibt exakt UNIT_STATS.king.size).
export function kingDisplaySize(kingLevel: number): number {
  return UNIT_STATS.king.size * kingSizeMult(kingLevel);
}

// Deterministischer Kern des XP-Gewinns (die PURE Version der Unit.gainKingXp-Schleife): vom
// Ausgangszustand (kingLevel, kingXp) wird amount addiert, dann werden – solange der Deckel nicht
// steht UND die nächste Schwelle erreicht ist – Schwellen verbraucht und Stufen aufgestiegen.
// xpToNext ist über die AKTUELLE Stufe indiziert (xpToNext[level] = XP bis zur nächsten); der
// maxLevel-Guard in der Schleife verhindert jeden Out-of-Bounds-Lesezugriff am oberen Ende.
// Auf maxLevel wird amount weiterhin GEBANKT (xp akkumuliert), aber NIE gelevelt – so geht keine
// eingesammelte Seele "verloren", der König wächst nur nicht mehr. Gibt das Ergebnis und die Zahl
// der tatsächlich gewonnenen Stufen zurück (der Aufrufer feuert pro Stufe sein Level-up-Juice).
export function applyKingXp(kingLevel: number, kingXp: number, amount: number): { level: number; xp: number; levelsGained: number } {
  let level = kingLevel;
  let xp = kingXp + amount;
  let levelsGained = 0;
  while (level < KING_PROGRESSION.maxLevel && xp >= KING_PROGRESSION.xpToNext[level]) {
    xp -= KING_PROGRESSION.xpToNext[level];
    level++;
    levelsGained++;
  }
  return { level, xp, levelsGained };
}
