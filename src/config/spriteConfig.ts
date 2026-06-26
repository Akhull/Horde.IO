import type { Faction } from "../types";

// ===========================================================================
//  Sprite- & Animationssystem – Konfiguration
// ===========================================================================
//
//  Hier steckst du DEINE eigenen Sprite-Sheets ein. Siehe SPRITES.md für eine
//  ausführliche Anleitung.
//
//  Ablauf:
//   1) Lege deine Sheet-PNGs unter  public/sprites/anim/  ab.
//   2) Trage sie unten in REAL_SHEETS ein (Frame-Grösse + Frame-Bereiche).
//   3) Fertig – die Einheit nutzt automatisch das Sheet + Animationen.
//
//  Solange für eine Einheit kein eigenes Sheet hinterlegt ist, greift der
//  prozedural erzeugte Demo-Charakter (DEMO_SHEET), damit du Animationen sofort
//  in Aktion siehst. Mit USE_DEMO_SPRITES = false fällt alles auf die alten
//  statischen Sprites zurück.
// ===========================================================================

export type AnimName = "idle" | "walk" | "attack" | "death";

export interface AnimDef {
  start: number; // erster Frame-Index
  end: number; // letzter Frame-Index
  frameRate: number; // Frames pro Sekunde
  repeat: number; // -1 = endlos, 0 = einmal
}

export interface SheetDef {
  /** Pfad relativ zu public/ (z. B. "assets/sprites/anim/human_king.png"). Leer lassen für das Demo-Sheet. */
  path?: string;
  frameWidth: number;
  frameHeight: number;
  anims: Partial<Record<AnimName, AnimDef>>;
}

// Demo-Charakter nur aktiv, falls für eine Einheit kein echtes Sheet existiert.
export const USE_DEMO_SPRITES = false;

// ---------------------------------------------------------------------------
//  DEINE Sheets:  spriteKey -> SheetDef
//  Gültige spriteKeys:  human_king, human_l1, human_l2, human_l3,
//                       elf_king,  elf_l1,  elf_l2,  elf_l3,
//                       orc_king,  orc_l1,  orc_l2,  orc_l3
//  (Bogenschützen nutzen denselben Key wie Vasallen der Stufe 1.)
// ---------------------------------------------------------------------------
//  Generiert von  tools/build-lpc-sprites.cjs  aus den LPC-Layern
//  (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0 – siehe CREDITS-LPC.md).
//  Einheit blickt zur Kamera (Down-Reihe). l1 = Bogenschütze (Shoot-Attacke).
export const REAL_SHEETS: Record<string, SheetDef> = {
  human_king: {
    path: "sprites/anim/human_king.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
  human_l1: {
    path: "sprites/anim/human_l1.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 23, frameRate: 16, repeat: 0 },
      death:  { start: 24, end: 29, frameRate: 9, repeat: 0 },
    },
  },
  human_l2: {
    path: "sprites/anim/human_l2.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
  human_l3: {
    path: "sprites/anim/human_l3.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
  elf_king: {
    path: "sprites/anim/elf_king.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
  elf_l1: {
    path: "sprites/anim/elf_l1.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 23, frameRate: 16, repeat: 0 },
      death:  { start: 24, end: 29, frameRate: 9, repeat: 0 },
    },
  },
  elf_l2: {
    path: "sprites/anim/elf_l2.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
  elf_l3: {
    path: "sprites/anim/elf_l3.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
  orc_king: {
    path: "sprites/anim/orc_king.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
  orc_l1: {
    path: "sprites/anim/orc_l1.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 23, frameRate: 16, repeat: 0 },
      death:  { start: 24, end: 29, frameRate: 9, repeat: 0 },
    },
  },
  orc_l2: {
    path: "sprites/anim/orc_l2.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
  orc_l3: {
    path: "sprites/anim/orc_l3.png",
    frameWidth: 64, frameHeight: 64,
    anims: {
      idle:   { start: 0, end: 1, frameRate: 3, repeat: -1 },
      walk:   { start: 2, end: 10, frameRate: 12, repeat: -1 },
      attack: { start: 11, end: 16, frameRate: 14, repeat: 0 },
      death:  { start: 17, end: 22, frameRate: 9, repeat: 0 },
    },
  },
};

// ---------------------------------------------------------------------------
//  Demo-Sheet (prozedural erzeugt, 12 Frames à 48px in einer Reihe)
// ---------------------------------------------------------------------------
export const DEMO_SHEET_KEY = "demo_unit";
export const DEMO_FRAME_SIZE = 48;
export const DEMO_FRAME_COUNT = 12;

export const DEMO_SHEET: SheetDef = {
  frameWidth: DEMO_FRAME_SIZE,
  frameHeight: DEMO_FRAME_SIZE,
  anims: {
    idle: { start: 0, end: 1, frameRate: 3, repeat: -1 },
    walk: { start: 2, end: 5, frameRate: 10, repeat: -1 },
    attack: { start: 6, end: 8, frameRate: 14, repeat: 0 },
    death: { start: 9, end: 11, frameRate: 8, repeat: 0 },
  },
};

// Fraktions-Einfärbung des (graustufigen) Demo-Charakters.
export const FACTION_TINT: Record<Faction, number> = {
  human: 0xf0dcb0,
  elf: 0x9fe0a0,
  orc: 0xe09878,
};
