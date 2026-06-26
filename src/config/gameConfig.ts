// Zentrale Spielkonstanten – 1:1 aus dem alten public/js/core/config.js übernommen,
// erweitert um Einheiten-Werte, die im Original über die Unit-Klasse verstreut waren.

export const CONFIG = {
  worldWidth: 9000,
  worldHeight: 9000,

  // Safe-Zone (Battle-Royale-Schrumpfkreis)
  safeZoneDelay: 50000, // Vorlauf bis zur ersten Schrumpfung (ms); kürzer = früherer Druck, weniger Anfangs-Leerlauf
  safeZonePauseDuration: 18000, // Atempause zwischen zwei Schrumpfstufen (ms)
  safeZoneMovePauseDuration: 10000, // Pause im Endgame, bevor der Min-Kreis weiterwandert (ms)
  safeZoneShrinkRate: 0.08, // Schrumpfgeschwindigkeit in px/ms (80 px/s) – strafft die Schrumpfphasen
  safeZoneMoveRate: 0.08, // Wandergeschwindigkeit des Endgame-Kreises in px/ms (an Shrink angeglichen)
  safeZoneMinRadius: 250,
  safeZoneStartRadius: 7000,

  // König-Fähigkeiten
  dashCooldown: 5000,
  dashDistance: 200,
  shieldAbilityCooldown: 10000,
  shieldAbilityDuration: 5000,

  formationUpdateInterval: 10000,
} as const;

// Einheiten-Grundwerte (im Original in Unit.js hartkodiert)
// Speed-Faktoren: Basis-Tempo * Einheiten-Modifikator * 1.88 (globaler Speed-Scale-Port aus dem Original).
//   King   = 1.35        * 1.88 = 2.538 px/frame (schnellster – Spieler-Avatar, soll Tempo machen)
//   Archer = 1.2         * 1.88 = 2.256 px/frame (~89% vom König: langsamster, soll kiten statt vorrennen)
//   Vassal = 1.35 * 0.95 * 1.88 = 2.411 px/frame (~95% vom König: folgt knapp dahinter in Formation)
// Die relative Staffelung (König > Vasall > Archer) ist stimmig und bleibt bewusst unverändert.
// Nahkampf-/Pfeilschaden ist jetzt pro Einheitentyp und Vasallen-Level gestaffelt
// (vorher gaben ALLE Einheiten flat 20). So lohnt sich das Leveln spürbar und der
// König hat echte Nahkampf-Präsenz. archer.damage ist der Pfeilschaden (vorher als
// Literal 10 in spawnProjectile hartkodiert) und bleibt unverändert.
//
// WICHTIG – `size` ist die ANZEIGEGRÖSSE (setDisplaySize), NICHT die Hitbox.
// Hitbox/Kollision/Formation/Healthbar laufen über HITBOX_SCALE (< 1, s. u.), damit
// die Figuren groß rendern, ohne den Kollisions-/Formations-Footprint aufzublähen.
//
// WARUM die King-`size` so viel größer ist als sie "wirken" muss: die Kenney-King-Chips
// (medievalUnit_05/17/23) haben DEUTLICH mehr transparenten Rand als die Vasallen-Chips –
// die eigentliche Figur füllt nur ~25.8% der Chip-Breite (Vasall ~32%). setDisplaySize
// skaliert das GANZE Chip inkl. Rand, der König rendert bei gleicher size also optisch
// ~24% KLEINER. Die King-size kompensiert diesen Padding-Unterschied UND macht ihn klar
// zum größten Sprite im Feld (optische Figur ~30px ggü. ~18–22px Vasall, ~28px Champion).
export const UNIT_STATS = {
  king: { hp: 300, speed: 1.35 * 1.88, size: 116, damage: 24 },
  archer: { hp: 100, speed: 1.2 * 1.88, size: 56, attackCooldown: 1500, attackRange: 300, damage: 10 },
  vassal: {
    hp: 100,
    speed: 1.35 * 0.95 * 1.88,
    sizeByLevel: { 1: 56, 2: 64, 3: 70 } as Record<number, number>,
    // Nahkampfschaden nach Stufe: L1 schwächer als zuvor, L2 = alter Flat-Wert, L3 stärker.
    damageByLevel: { 1: 15, 2: 20, 3: 25 } as Record<number, number>,
  },
  // Champion: legendäre Spezialeinheit, beschworen aus einem Gold-Orb.
  // Nutzt das l3-Sprite, rendert deutlich größer als ein Vasall (elitäre "legendär"-Optik),
  // bleibt aber unter dem König (der als Anführer klar dominieren soll). Zäh und schlagkräftig,
  // läuft mit Vasallen-Tempo in der Formation mit. MECHANIK steht in LEGENDARY (Aura/Reichweite/AoE).
  champion: { hp: 200, speed: 1.35 * 0.95 * 1.88, size: 90, damage: 35 },
} as const;

// Hitbox-Skalierung: die ANZEIGEGRÖSSE (UNIT_STATS.size) ist bewusst entkoppelt von der
// logischen Hitbox (width/height). width/height = size * HITBOX_SCALE und speisen Kollision
// (resolveUnitUnitCollisions: width/2 + width/2), Formation (Mindestabstände), Separation und
// die Healthbar-/Ring-Breite. So rendern die Figuren groß und lesbar, während der Kollisions-/
// Formations-Footprint moderat bleibt (König-Hitbox ~52px ggü. Formation-Mindestabstand 60–100px,
// Separation-Wunschabstand 30px) – die Formationen/Separation gehen NICHT kaputt. Healthbar und
// Ringe orientieren sich an der sichtbaren Figur (barRef in Unit.ts), nicht an der Hitbox.
export const HITBOX_SCALE = 0.45;

// Power-Up-Stärken zentral, statt als Literale in Unit/PowerUp verstreut.
// Spiegelt bewusst den Tempo-Boost (x1.5 / 6 s, siehe PowerUp-Default-Dauer):
// ein gleich starker, gleich langer OFFENSIV-Boost als Gegenstück zum Tempo.
// damageMultiplier wirkt OBEN AUF den Fraktions-Schadensmodifikator (meleeDamage)
// und auf den Pfeilschaden – kurzzeitig deutlich härtere Schläge.
// armorMultiplier ist das DEFENSIVE Gegenstück (gleiche 6-s-Dauer): er skaliert
// EINGEHENDEN Schaden in takeDamage (Kampf) und in applySafeZoneDamage (Zonenrand).
// 0.6 = −40% Schaden – spürbar, aber kein Unsterblichkeits-Knopf, und symmetrisch
// zur +50% Offensive des Damage-Boosts. Stapelt multiplikativ mit dem Schild
// (Schild halbiert NUR Zonenschaden): am Zonenrand 0.5 × 0.6 = 0.3 (kein Doppel-
// Abzug desselben Effekts, sondern zwei bewusst kombinierbare Schutzschichten).
// lifestealFactor ist OFFENSIVE SUSTAIN (gleiche 6-s-Dauer): der Angreifer heilt
// sich um diesen Anteil des AUSGETEILTEN Schadens (Nahkampf + Pfeil), geklemmt auf
// sein fraktions-skaliertes maxHp (kein Überheilen). 0.35 = bewusst schwächer als
// die +50% des Damage-Boosts: er belohnt nur aktives Zuschlagen (nutzlos beim
// Wandern/Fliehen) und kann allein keine Schlacht kippen, hält den König aber im
// Gewühl länger am Leben – ein drittes, distinktes Offensiv-Profil neben dmg/armor.
// regenPerSecond ist PASSIVE SUSTAIN (gleiche 6-s-Dauer): der Träger regeneriert
// HP pro Sekunde, GEKLEMMT auf sein fraktions-skaliertes maxHp (kein Überheilen).
// 10 hp/s × 6 s = ~60 HP – ~20% eines Königs-HP-Pools (300). Im Gegensatz zum
// Lifesteal (nur beim Zuschlagen, 0.35× ausgeteilter Schaden) heilt regen IMMER,
// auch beim Fliehen/Wandern – das defensive, passive Gegenstück, das einen
// angeschlagenen König wieder kampffähig macht, ohne ihn unsterblich zu machen.
// 10 statt 12 hp/s bewusst: bricht die Sustain/Schaden-PARITÄT, wenn regen +
// Lifesteal + Armor zusammentreffen (sonst Endlos-Patt bei symmetrischem Kampf).
// Netto-Schaden bleibt positiv (~26.8 dps Sustain vs. ~28.8 dps eingehend → −2 dps).
export const POWERUP = {
  damageMultiplier: 1.5, // Nahkampf- UND Pfeilschaden während des Boosts
  armorMultiplier: 0.6, // eingehender Schaden während des Armor-Boosts (−40%)
  lifestealFactor: 0.35, // geheilter Anteil des ausgeteilten Schadens (Lifesteal)
  regenPerSecond: 10, // passiv regenerierte HP pro Sekunde während des Regen-Boosts
  knockbackResistFactor: 0.2, // verbleibender Anteil des Rückstoß-Impulses während "steady" (0.2 = 20% bleiben, −80% Knockback)
  // Steady-Tempo-Bonus: damit "steady" auch für den SPIELER-König einen spürbaren Nutzen
  // hat (der Spieler nimmt per Design keinen Rückstoß, der Resist-Anteil greift bei ihm
  // also nicht), gibt steady ZUSÄTZLICH einen kleinen Bewegungs-Boost (+10%) – "standfest"
  // = momentumstark unterwegs. Gilt für Spieler UND KI; getrennt vom Speed-Orb (×1.5),
  // multipliziert sich sauber mit ihm (1.5 × 1.1) und wird read-time gelesen (kein State-Leak).
  steadyMoveFactor: 1.1, // Bewegungs-Multiplikator während "steady" (+10%)
} as const;

// Legendäre Spezialeinheiten pro Fraktion (aus Gold-Orbs beschworen).
// Jede Rasse bekommt eine EINZIGARTIGE Mechanik passend zu ihrem Flavor-Text –
// so wird die Rassenwahl erstmals wirklich relevant (über die ±10% FACTION_STATS hinaus):
//   human – Paladin   ("standhaft"):   Heil-Aura für nahe Verbündete (Sustain-Anker).
//   elf   – Erzschütze ("treffsicher"): Fernkämpfer mit großer Reichweite (kitet/snipet).
//   orc   – Berserker  ("schlagkräftig"): Nahkampf mit AoE-Schlag + Knockback (Massen-Wucht).
// Grund-HP/-Größe kommen aus UNIT_STATS.champion (+ FACTION_STATS); hier nur die Mechanik.
export const LEGENDARY: Record<
  Faction,
  {
    name: string;
    ranged: boolean; // true -> verhält sich wie ein Bogenschütze (Elf-Erzschütze)
    // Paladin (human): periodische Heil-Aura
    auraRange?: number;
    healPerPulse?: number;
    pulseInterval?: number; // ms zwischen Heil-Pulsen
    // Erzschütze (elf): Fernkampf-Override (sonst gälten die Archer-Grundwerte)
    attackRange?: number;
    attackCooldown?: number;
    rangedDamage?: number;
    // Berserker (orc): AoE bei jedem Nahkampftreffer
    aoeRange?: number;
    aoeDamageFactor?: number; // Anteil des Haupttreffer-Schadens an umstehende Gegner
    aoeKnockback?: number; // zusätzlicher Rückstoß-Impuls auf AoE-Opfer
  }
> = {
  human: { name: "Paladin", ranged: false, auraRange: 200, healPerPulse: 8, pulseInterval: 1000 },
  elf: { name: "Erzschütze", ranged: true, attackRange: 480, attackCooldown: 1100, rangedDamage: 26 },
  orc: { name: "Berserker", ranged: false, aoeRange: 95, aoeDamageFactor: 0.6, aoeKnockback: 6 },
};

// Kampf-Feedback ("Juice") – zentral tunbar, damit Treffer sich anfühlen.
export const FEEDBACK = {
  flashDuration: 90, // ms weißer Aufleucht-Flash bei Treffer
  knockback: 3.2, // Rückstoß-Impuls (px) bei einem Treffer
  knockbackDecay: 0.8, // Geschwindigkeits-Abbau pro Update
  kingKnockbackFactor: 0.25, // Könige werden weniger zurückgestoßen (schwerer)
  shakeOnPlayerHit: 0.006, // Kamera-Shake-Intensität, wenn der Spielerkönig getroffen wird
  shakeDuration: 110, // ms
  kingDeathShake: 0.006, // Shake bei sichtbarem Königstod
  damageNumbers: true, // Schadenszahlen für sichtbare Treffer anzeigen
  maxDamageNumbers: 16, // gleichzeitig aktive Schadenszahlen (Performance-Deckel)
  vignettePeak: 0.55, // Spitzen-Alpha des roten Schaden-Vignette-Flashs
} as const;

// Verteidigungstürme: neutrale Gebäude (Typ "tower"), die auf alle Fraktionen feuern.
export const TOWER = {
  range: 260, // Reichweite, in der Einheiten beschossen werden (bewusst < Archer-Range 300, damit Archer Türme kontern können)
  damage: 12, // Schaden pro Pfeil (7.5 DPS bei fireInterval 1600ms) – Türme beißen beim Durchqueren spürbarer, bleiben aber kein Königskiller
  fireInterval: 1600, // ms zwischen Schüssen
  team: -1, // gehört keinem König -> feindlich zu allen
} as const;

// KI-König-Verhalten: Persönlichkeits-Tiers + globale Tuning-Werte.
// Jeder der 10 KI-Könige bekommt im Konstruktor zufällig ein Tier zugewiesen.
// Die Tiers modulieren NUR das Königs-Verhalten (Vasallen bleiben unverändert),
// damit sich das Match lebendig und unterschiedlich anfühlt statt 10x identisch.
export const AI = {
  // Persönlichkeits-Tiers. Werte sind bewusst grob gestaffelt, damit der
  // Unterschied im Spiel spürbar ist (nicht nur kosmetisch).
  personalities: {
    // Draufgänger: grosse Aggro-Reichweite, flieht erst spät, sammelt kaum.
    aggressive: {
      aggroRange: 520, // wie weit er Gegner-Könige aktiv jagt
      retreatHpFactor: 0.2, // flieht erst unter 20% HP
      regroupHpFactor: 0.45, // kehrt ab 45% HP zurück in den Kampf
      soulGreed: 0.4, // niedrige Gier -> sammelt nur sehr nahe Seelen
      soulRange: 320, // Suchradius für Seelen/Power-Ups
      finishHpRatio: 0.7, // greift Gegner-König als "Finish" an, wenn dessen HP < 70%
      powerUpDesire: 0.6, // < 1: Power-Ups wirken weniger attraktiv (lieber kämpfen)
    },
    // Ausgewogen: Standard-Verhalten, mischt Kämpfen und Sammeln.
    balanced: {
      aggroRange: 400,
      retreatHpFactor: 0.3,
      regroupHpFactor: 0.55,
      soulGreed: 0.65,
      soulRange: 460,
      finishHpRatio: 0.55,
      powerUpDesire: 1.0, // neutral: Power-Up ~ gleich attraktiv wie eine Seele gleicher Distanz
    },
    // Vorsichtig: meidet Risiko, sammelt viel, flieht früh und snowballt über Seelen.
    cautious: {
      aggroRange: 300,
      retreatHpFactor: 0.42,
      regroupHpFactor: 0.65,
      soulGreed: 0.95,
      soulRange: 620,
      finishHpRatio: 0.4,
      powerUpDesire: 1.5, // > 1: wertet Power-Ups höher (Schild/Tempo zum Überleben/Snowball)
    },
  },
  // Pool, aus dem im Konstruktor gezogen wird (gleichverteilt über Math.random()).
  personalityPool: ["aggressive", "balanced", "cautious"] as const,

  // Ausweich-/Pathing-Tuning (gilt für alle KI-Könige).
  projectileDodgeRange: 150, // Radius, in dem feindlichen Pfeilen ausgewichen wird
  towerAvoidPadding: 40, // Sicherheitspuffer über TOWER.range hinaus
  towerAvoidWeight: 1.6, // Gewicht der Turm-Abstoßung (stärker als Projektil-Dodge)
  zoneEdgePadding: 100, // ab dieser Distanz zum Zonenrand wird nach innen gedrängt
  hordeWeakThreshold: 3, // Gegner-König mit < so vielen Begleitern gilt als lohnend/schwach
  hordeSearchRange: 280, // Umkreis, in dem die Begleiter eines Gegner-Königs gezählt werden
} as const;

export type AIPersonality = keyof typeof AI.personalities;

// Schwierigkeitsgrade: skalieren NUR die KI über Multiplikatoren, der Spieler
// behält seine Grundwerte. Die Felder sind reine Faktoren (1.0 = unverändert):
//   aiAggression -> skaliert KI-Königs-Aggro/Mut (aggroRange, finishHpRatio, ...)
//   aiDamage     -> skaliert den von KI-Einheiten verursachten Schaden
//   aiSoulGreed  -> skaliert die Sammel-Gier der KI-Könige (soulGreed)
//   playerDamageTaken (optional) -> Spieler nimmt mehr Schaden (nur Hardcore)
// Werte sind bewusst spürbar, aber nicht absurd gestaffelt. Die Objekte sind
// `as const` und werden NIE mutiert – die Laufzeit-Anwendung erzeugt Kopien
// (siehe src/systems/difficulty.ts).
export const DIFFICULTY = {
  leicht: { aiAggression: 0.7, aiDamage: 0.8, aiSoulGreed: 0.9, playerDamageTaken: 1.0, label: "Leicht" },
  normal: { aiAggression: 1.0, aiDamage: 1.0, aiSoulGreed: 1.0, playerDamageTaken: 1.0, label: "Normal" },
  schwer: { aiAggression: 1.3, aiDamage: 1.2, aiSoulGreed: 1.1, playerDamageTaken: 1.0, label: "Schwer" },
  hardcore: { aiAggression: 1.6, aiDamage: 1.4, aiSoulGreed: 1.2, playerDamageTaken: 1.25, label: "Hardcore" },
} as const;

export type Difficulty = keyof typeof DIFFICULTY;

// Reihenfolge für die UI (leicht -> hardcore) und Default-Auswahl.
export const DIFFICULTY_ORDER = ["leicht", "normal", "schwer", "hardcore"] as const;
export const DEFAULT_DIFFICULTY: Difficulty = "normal";

export const FACTIONS = ["human", "elf", "orc"] as const;
export type Faction = (typeof FACTIONS)[number];

// Fraktions-Identität: bislang waren Human/Elf/Orc rein kosmetisch (gleiche Werte,
// nur andere Sprites). FACTION_STATS gibt jeder Fraktion ein echtes Spielgefühl über
// kleine MULTIPLIKATIVE Modifikatoren auf die UNIT_STATS-Grundwerte (hp, speed, damage).
//
// WICHTIG – warum multiplikativ und uniform pro Fraktion:
//   Der Modifikator wird auf JEDEN Einheitentyp (König, Vasall, Archer, Champion)
//   einer Fraktion mit demselben Faktor angewandt. Dadurch bleibt die bewusst
//   gestaffelte interne Reihenfolge erhalten (König > Vasall > Archer beim Tempo,
//   gestaffelter Vasallen-Schaden nach Level). Ein Elf-König ist also weiterhin
//   schneller als ein Elf-Archer – nur die GANZE Fraktion ist um 10% flotter.
//   attackRange und Cooldowns bleiben absichtlich UNANGETASTET (kein Reichweiten-/
//   Feuerraten-Vorteil), damit die Identität rein über Zähigkeit/Tempo/Wucht entsteht.
//   Alle Abweichungen liegen innerhalb ±10%, damit keine Fraktion dominiert.
//
// INTENT & ERWARTETER MATCH-EFFEKT pro Fraktion:
//   human  – Referenz/ausgewogen. Keine Stärke, keine Schwäche. Verlässliche
//            Allrounder; das Match spielt sich "neutral", ideal als Lern-/Baseline-Wahl.
//   elf    – schnelle, fragile Skirmisher (-10% HP, +10% Tempo). Erreichen Seelen/
//            Power-Ups und Zonenränder zuerst, kiten und disengagen besser, sterben
//            aber schneller im direkten Stand-and-Fight. Belohnt aktives Positionsspiel.
//   orc    – langsame, zähe Brecher (+10% HP, -5% Tempo, +10% Schaden). Gewinnen
//            stehende Nahkämpfe und überleben Safe-Zone-Druck länger, verlieren aber
//            Rennen um Loot und können schlechter aus verlorenen Kämpfen fliehen.
//
// Hinweis zur Balance: Das reine Produkt der Faktoren liegt bei Orc etwas höher
// (~1.15) als bei Elf (~0.99). Das ist Absicht – der Tempo-Malus des Orcs ist im
// Spiel ein echter Nachteil (Kiten/Loot-Rennen/Flucht), den das Produkt unterschätzt,
// während der Elf-Tempobonus mehr wert ist, als sein Produkt suggeriert.
export const FACTION_STATS: Record<Faction, { hp: number; speed: number; damage: number }> = {
  human: { hp: 1.0, speed: 1.0, damage: 1.0 }, // balancierte Referenz
  elf: { hp: 0.9, speed: 1.1, damage: 1.0 }, // schnell, fragil – Skirmisher
  orc: { hp: 1.1, speed: 0.95, damage: 1.1 }, // langsam, zäh, schlagkräftig – Brecher
} as const;

// Tiefen-Ebenen für die Phaser-Darstellung (z-Sortierung)
export const DEPTH = {
  ground: -100,
  obstacle: -50,
  building: 0,
  soul: 5,
  powerup: 6,
  shadow: 8,
  unit: 10,
  healthbar: 20,
  slash: 25,
  projectile: 30,
  safezone: 40,
  fx: 50,
  floatingText: 60,
} as const;
