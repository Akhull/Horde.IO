import Phaser from "phaser";
import type { Faction } from "../types";
import type { Difficulty } from "../config/gameConfig";

// Steuerschicht UI -> Engine. Hält die Phaser.Game-Instanz und kapselt alle
// Aktionen, die die DOM-UI auf der Engine auslöst (Spiel starten/stoppen,
// Lautstärke, UI-Klick-Sound, Musik). So bleibt die UI frei von Phaser-Details.

let game: Phaser.Game | null = null;
let music: Phaser.Sound.BaseSound | null = null;

export function setGame(g: Phaser.Game): void {
  game = g;
}

// Startet (oder restartet) die Spielszene mit Fraktion + Schwierigkeit.
export function startGame(faction: Faction, difficulty: Difficulty): void {
  if (!game) return;
  ensureMusic();
  game.scene.start("Game", { faction, difficulty });
}

// Beendet die laufende Partie (z. B. "zurück ins Hauptmenü").
export function stopGame(): void {
  if (!game) return;
  if (game.scene.isActive("Game") || game.scene.isPaused("Game")) {
    game.scene.stop("Game");
  }
}

// ---- Pause: friert die Spielszene von aussen ein/auf -----------------------
export function pauseGame(): void {
  if (game?.scene.isActive("Game")) game.scene.pause("Game");
}
export function resumeGame(): void {
  if (game?.scene.isPaused("Game")) game.scene.resume("Game");
}
export function isGamePaused(): boolean {
  return !!game?.scene.isPaused("Game");
}
// Läuft gerade eine Partie (aktiv ODER pausiert)?
export function isGameRunning(): boolean {
  return !!game && (game.scene.isActive("Game") || game.scene.isPaused("Game"));
}

// Lautstärke setzen (Registry ist die gemeinsame Quelle für SoundManager &
// Musik) und ggf. die laufende Musik live nachregeln.
export function setVolume(kind: "musicVolume" | "sfxVolume", value: number): void {
  if (!game) return;
  game.registry.set(kind, value);
  if (kind === "musicVolume" && music) {
    (music as Phaser.Sound.WebAudioSound).setVolume(value);
  }
}

export function getVolume(kind: "musicVolume" | "sfxVolume"): number {
  return (game?.registry.get(kind) as number) ?? 0.5;
}

// Kurzer Mittelalter-Klick für UI-Interaktionen.
export function playClick(): void {
  if (!game || !game.cache.audio.exists("ui_click")) return;
  game.sound.play("ui_click", { volume: getVolume("sfxVolume") });
}

// Hintergrundmusik einmalig starten. Muss aus einer User-Geste heraus laufen
// (Browser-Autoplay-Sperre) – daher von Button-Klicks aufgerufen.
export function ensureMusic(): void {
  if (!game || music || !game.cache.audio.exists("music")) return;
  music = game.sound.add("music", { loop: true, volume: getVolume("musicVolume") });
  music.play();
}

// Mobile-Steuerung: vom DOM gesetzte Werte, die GameScene.readInput per Registry liest.
export function setJoystick(x: number, y: number): void {
  game?.registry.set("joyX", x);
  game?.registry.set("joyY", y);
}
export function setActionButton(key: "btnDash" | "btnShield", down: boolean): void {
  game?.registry.set(key, down);
}
