import Phaser from "phaser";

// Wiederverwendbarer Menü-Button im Mittelalter-Look.
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: { width?: number; fontSize?: number } = {}
): Phaser.GameObjects.Container {
  const width = opts.width ?? 300;
  const height = 56;
  const fontSize = opts.fontSize ?? 24;

  const bg = scene.add.rectangle(0, 0, width, height, 0xf5f0e1, 0.9).setStrokeStyle(2, 0x5b4326);
  const text = scene.add
    .text(0, 0, label, { fontFamily: "Cinzel, serif", fontSize: `${fontSize}px`, color: "#2a1d0e" })
    .setOrigin(0.5);

  const container = scene.add.container(x, y, [bg, text]).setSize(width, height);
  container.setInteractive(new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height), Phaser.Geom.Rectangle.Contains);

  container.on("pointerover", () => {
    bg.setFillStyle(0xffffff, 1);
    scene.tweens.add({ targets: container, scale: 1.05, duration: 120 });
  });
  container.on("pointerout", () => {
    bg.setFillStyle(0xf5f0e1, 0.9);
    scene.tweens.add({ targets: container, scale: 1.0, duration: 120 });
  });
  container.on("pointerdown", () => {
    const vol = (scene.registry.get("sfxVolume") as number) ?? 0.5;
    scene.sound.play("ui_click", { volume: vol });
    onClick();
  });

  return container;
}

// Fügt einen vollflächigen Hintergrund hinzu, der den Bildschirm füllt (cover).
export function addCoverBackground(scene: Phaser.Scene, key: string): Phaser.GameObjects.Image {
  const { width, height } = scene.scale;
  const img = scene.add.image(width / 2, height / 2, key);
  const scale = Math.max(width / img.width, height / img.height);
  img.setScale(scale).setScrollFactor(0);
  return img;
}
