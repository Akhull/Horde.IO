// public/js/main.js
console.log("main.js loaded");

import { Game } from "./core/Game.js";

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM fully loaded. Initializing game.");
  // Stelle sicher, dass der Container existiert
  const container = document.getElementById("gameCanvasContainer");
  if (!container) {
    console.error("Das Container-Element 'gameCanvasContainer' wurde nicht gefunden.");
    return;
  }
  
  // Initialisiere das Spiel
  const game = new Game();
});
