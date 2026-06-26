import "./styles.css";
import { buildScreens } from "./screens";
import { buildHud } from "./hud";

// Baut die komplette DOM-UI (Menüs + HUD) auf und hängt sie an <body>.
// Wird einmal aus main.ts nach dem Erstellen des Phaser-Spiels aufgerufen.
export function initUI(): void {
  // Touch-Geräte erkennen -> Touch-Controls im HUD einblenden (CSS).
  const isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add("is-touch");

  buildHud(document.body); // #hud  (z-index 9, über dem Canvas)
  buildScreens(document.body); // #ui (z-index 10, über dem HUD)
}
