import { Game } from "./core/Game.js";
import MapGenerator from "./mapgenerator/mapgenerator.js";
import * as THREE from "three";

document.addEventListener("DOMContentLoaded", () => {
  // Verwende den Canvas aus der index.html, damit der Three.js-Renderer ihn nutzt
  const canvas = document.getElementById("gameCanvas");
  // Initialisiere das Spiel und übergebe dabei den Canvas (sofern deine Game-Klasse das unterstützt)
  const game = new Game({ canvas: canvas });

  // Erstelle die 3D-Map und füge sie der Spielszene hinzu
  const mapGenerator = new MapGenerator();
  const map = mapGenerator.getMap();
  game.scene.add(map);

  // Bestimme den Spawnpunkt – falls der MapGenerator eine Methode dafür bereitstellt,
  // sonst als Fallback der Ursprung
  const spawnPoint = (typeof mapGenerator.getSpawnPosition === "function")
    ? mapGenerator.getSpawnPosition()
    : new THREE.Vector3(0, 0, 0);

  // Lade die Spieler-Textur und erstelle ein Sprite für den Spieler
  const loader = new THREE.TextureLoader();
  loader.load(
    "assets/sprites/Units/Mensch/King.png",
    (texture) => {
      const material = new THREE.SpriteMaterial({ map: texture });
      const playerSprite = new THREE.Sprite(material);
      // Passe die Größe des Sprites an (je nach gewünschter Darstellung)
      playerSprite.scale.set(2, 2, 1);
      playerSprite.position.copy(spawnPoint);
      game.scene.add(playerSprite);

      // Falls vorhanden: Richte die Kamera auf den Spieler aus
      if (typeof game.setCameraTarget === "function") {
        game.setCameraTarget(playerSprite);
      }
    },
    undefined,
    (error) => {
      console.error("Fehler beim Laden der Spieler-Textur:", error);
    }
  );

  // Starte den Spiel-Loop, falls die Methode existiert
  if (typeof game.start === "function") {
    game.start();
  }
});
