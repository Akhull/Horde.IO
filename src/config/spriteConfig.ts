import type { SoulType } from "../types";

// ===========================================================================
//  Sprite-Konfiguration (statische Kenney-Sprites)
// ===========================================================================
//
//  Die Einheiten-/Gebäude-Texturen kommen direkt als statische PNGs aus dem
//  Kenney-medieval-rts-Pack (Faktionsfarben sind ins Sprite gebacken -> kein
//  Tint). Es gibt kein Sprite-Sheet-/Animationssystem mehr; die einzige
//  verbleibende Tabelle hier ist die Orb-Einfärbung der Seelen.
// ===========================================================================

// Orb-Einfärbung (Tint) pro Seelen-Rarität. Eine einzige near-weisse Orb-Textur
// (particle-pack "orb") wird zur Laufzeit per setTint in diese Farben getönt –
// kein eigenes PNG pro Farbe nötig. Neue Rarität = eine Zeile (+ SoulType-Typ).
export const ORB_TINT: Record<SoulType, number> = {
  green: 0x4ade80, // Vasall (häufig)
  blue: 0x3b82f6, // Level-up auf 2
  purple: 0xa855f7, // Level-up auf 3
  gold: 0xffd700, // legendär (Champion)
};

// Tint für die pulsierende ADD-Blend-Aura unter Elite-Einheiten (Champion + Level-3-
// Vasall). Bewusst NICHT identisch mit ORB_TINT: unter BlendMode.ADD verwaschen
// gesättigte Farben, darum ist Gold etwas wärmer/heller (0xffd24a) und Lila deutlich
// aufgehellt (0xc77bff), damit die Aura satt leuchtet statt matt zu wirken. Die
// Farb-IDENTITÄT (Gold = Champion, Lila = Level-3) bleibt von Orb über Aura bis zum
// HUD-Badge konsistent – darum leben die Konstanten hier neben ORB_TINT an einer Stelle.
export const AURA_TINT = {
  champion: 0xffd24a, // Gold-Aura (legendärer Champion aus Gold-Orb)
  elite: 0xc77bff, // Lila-Aura (Level-3-Vasall aus Lila-Orb)
};
