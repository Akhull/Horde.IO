import Phaser from "phaser";
import { addCoverBackground, makeButton } from "./ui";

// Optionen mit zwei Lautstärkereglern (Musik & Soundeffekte).
export class OptionsScene extends Phaser.Scene {
  constructor() {
    super("Options");
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.fadeIn(300, 0, 0, 0);
    addCoverBackground(this, "bg_options");

    this.add
      .text(width / 2, height * 0.22, "Optionen", { fontFamily: "Cinzel, serif", fontSize: "48px", color: "#ffffff" })
      .setOrigin(0.5)
      .setShadow(2, 2, "#000000", 6);

    this.makeSlider(width / 2, height * 0.42, "Musik", "musicVolume", (v) => {
      const music = this.sound.get("music");
      if (music) (music as Phaser.Sound.WebAudioSound).setVolume(v);
    });
    this.makeSlider(width / 2, height * 0.56, "Soundeffekte", "sfxVolume");

    makeButton(this, width / 2, height * 0.72, "Zurück", () => this.scene.start("Menu"));
  }

  private makeSlider(cx: number, cy: number, label: string, registryKey: string, onChange?: (v: number) => void): void {
    const trackW = 300;
    const left = cx - trackW / 2;
    const value = (this.registry.get(registryKey) as number) ?? 0.5;

    this.add
      .text(cx, cy - 28, label, { fontFamily: "Cinzel, serif", fontSize: "22px", color: "#ffffff" })
      .setOrigin(0.5)
      .setShadow(1, 1, "#000000", 3);

    this.add.rectangle(cx, cy, trackW, 8, 0x000000, 0.5).setStrokeStyle(1, 0xffffff);
    const fill = this.add.rectangle(left, cy, trackW * value, 8, 0xc9a227).setOrigin(0, 0.5);
    const knob = this.add.circle(left + trackW * value, cy, 14, 0xf5f0e1).setStrokeStyle(2, 0x5b4326);
    knob.setInteractive({ draggable: true, useHandCursor: true });

    this.input.setDraggable(knob);
    knob.on("drag", (_p: Phaser.Input.Pointer, dragX: number) => {
      const clamped = Phaser.Math.Clamp(dragX, left, left + trackW);
      knob.x = clamped;
      const v = (clamped - left) / trackW;
      fill.width = trackW * v;
      this.registry.set(registryKey, v);
      onChange?.(v);
    });
  }
}
