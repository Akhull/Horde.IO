import Phaser from "phaser";
import Stats from "stats.js";
import { gameRef } from "./bus";

// Performance-Overlay (stats.js): FPS / Frame-ms / Speicher live, plus zwei eigene
// Panels für die für DIESES Spiel relevanten Lasttreiber – Einheitenzahl und die
// Gesamtzahl der Phaser-Display-Objekte (grober Proxy für die Render-Last).
//
// Gemessen wird der GANZE Frame: begin() am Loop-Start (PRE_STEP), end() nach dem
// Rendern (POST_RENDER) – so enthält die ms-Anzeige Simulation UND Darstellung.
//
// Sichtbarkeit: standardmässig an, mit F3 umschaltbar (in localStorage gemerkt).
// Start verstecken mit ?stats=off. Das Overlay blockiert keine Eingaben.

const STORAGE_KEY = "horde.perfOverlay";

export function initPerfOverlay(game: Phaser.Game): void {
  const stats = new Stats();
  // Eigene Panels NACH den Standard-Panels anhängen (werden unten mit aufgedeckt).
  const unitsPanel = stats.addPanel(new Stats.Panel("UNITS", "#7ab8ff", "#04101f"));
  const objPanel = stats.addPanel(new Stats.Panel("OBJ", "#ffb86c", "#1f1004"));

  const dom = stats.dom;
  // Alle Panels nebeneinander zeigen (stats.js blendet sonst alle bis auf eines aus).
  dom.style.cssText = "position:fixed;bottom:0;left:0;display:flex;gap:2px;z-index:10000;opacity:0.92;pointer-events:none;";
  for (const child of Array.from(dom.children) as HTMLElement[]) child.style.display = "block";

  // Welt-Seed-Anzeige (oben links): macht den deterministischen Seed sichtbar + testbar.
  // Gleicher Seed (?seed=N in der URL) => identische Welt. Teilt die F3-Sichtbarkeit.
  const seedDom = document.createElement("div");
  seedDom.style.cssText =
    "position:fixed;top:0;left:0;z-index:10000;font:12px/1.5 monospace;color:#7ab8ff;background:#04101f;padding:2px 7px;opacity:0.92;pointer-events:none;";
  seedDom.textContent = "SEED —";
  document.body.appendChild(seedDom);

  // Graph-Skalen wachsen mit dem bisher gesehenen Maximum (kein Beschneiden).
  let unitsMax = 50;
  let objMax = 200;

  game.events.on(Phaser.Core.Events.PRE_STEP, () => stats.begin());
  game.events.on(Phaser.Core.Events.POST_RENDER, () => {
    const scene = gameRef.current;
    if (scene) {
      seedDom.textContent = "SEED " + scene.seed;
      const units = scene.units.length;
      unitsMax = Math.max(unitsMax, units);
      unitsPanel.update(units, unitsMax);

      const objs = scene.children.length;
      objMax = Math.max(objMax, objs);
      objPanel.update(objs, objMax);
    }
    stats.end();
  });

  // Sichtbarkeit: gemerkter Zustand > ?stats=off > Default (an).
  const params = new URLSearchParams(location.search);
  let visible = params.get("stats") !== "off";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) visible = stored === "1";

  const apply = (): void => {
    dom.style.visibility = visible ? "visible" : "hidden";
    seedDom.style.visibility = visible ? "visible" : "hidden";
  };
  apply();

  window.addEventListener("keydown", (e) => {
    if (e.code !== "F3") return;
    e.preventDefault();
    visible = !visible;
    localStorage.setItem(STORAGE_KEY, visible ? "1" : "0");
    apply();
  });

  document.body.appendChild(dom);
}
