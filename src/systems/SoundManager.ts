import Phaser from "phaser";

// Verwaltet Musik, die dynamische "Kriegs-Ambience" und räumliche Soundeffekte.
// Port von public/js/core/SoundManager.js auf die Phaser-Sound-API.
export class SoundManager {
  private scene: Phaser.Scene;
  private warAmbience?: Phaser.Sound.BaseSound;
  private currentWarVolume = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get sfxVolume(): number {
    return (this.scene.registry.get("sfxVolume") as number) ?? 0.5;
  }

  get musicVolume(): number {
    return (this.scene.registry.get("musicVolume") as number) ?? 0.5;
  }

  startWarAmbience(): void {
    if (this.warAmbience) return;
    this.warAmbience = this.scene.sound.add("war_ambience", { loop: true, volume: 0 });
    this.warAmbience.play();
  }

  stopAll(): void {
    this.warAmbience?.stop();
    this.warAmbience = undefined;
  }

  // Zielvolumen der Schlacht-Ambience (0..1, vor Master-SFX-Skalierung).
  setWarAmbienceVolume(target: number): void {
    if (!this.warAmbience) return;
    this.currentWarVolume = Phaser.Math.Clamp(target, 0, 1);
    const applied = Phaser.Math.Clamp(this.currentWarVolume * this.sfxVolume, 0, 1);
    (this.warAmbience as Phaser.Sound.WebAudioSound).setVolume(applied);
  }

  // Räumlicher Soundeffekt: leiser/lautloser je weiter von der Kameramitte entfernt.
  playSpatial(key: string, sourceX: number, sourceY: number, volumeScale = 1.0): void {
    const cam = this.scene.cameras.main;
    const camCenterX = cam.scrollX + cam.width / 2 / cam.zoom;
    const camCenterY = cam.scrollY + cam.height / 2 / cam.zoom;
    const distance = Math.hypot(sourceX - camCenterX, sourceY - camCenterY);

    const maxAudible = 1200;
    const falloffStart = 300;
    let volume = this.sfxVolume * volumeScale;
    if (distance > maxAudible) volume = 0;
    else if (distance > falloffStart) {
      volume *= Math.max(0, 1 - (distance - falloffStart) / (maxAudible - falloffStart));
    }
    if (volume <= 0.01) return;
    this.scene.sound.play(key, { volume: Phaser.Math.Clamp(volume, 0, 1) });
  }

  playUI(key: string, volumeScale = 1.0): void {
    this.scene.sound.play(key, { volume: Phaser.Math.Clamp(this.sfxVolume * volumeScale, 0, 1) });
  }
}
