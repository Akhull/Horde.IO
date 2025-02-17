import { Game } from "./core/Game.js";
import MapGenerator from "./mapgenerator/mapgenerator.js";

document.addEventListener("DOMContentLoaded", () => {
  const game = new Game();
  
  // Erstelle die 3D-Map und füge sie der Spielszene hinzu
  const mapGenerator = new MapGenerator();
  game.scene.add(mapGenerator.getMap());
});
