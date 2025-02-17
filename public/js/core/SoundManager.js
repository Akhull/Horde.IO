// public/js/core/SoundManager.js

export class SoundManager {
  constructor() {
    this.bgMusic = document.getElementById("bgMusic");
    if (this.bgMusic) {
      // Setze die initiale Lautstärke (0.5 entspricht 50%)
      this.bgMusic.volume = 0.5;
      this.initVolumeSlider();
    }
  }

  initVolumeSlider() {
    const musicSlider = document.getElementById("musicVolumeSlider");
    if (musicSlider) {
      // Synchronisiere den Slider mit der aktuellen Lautstärke
      musicSlider.value = this.bgMusic.volume * 100;
      musicSlider.addEventListener("input", () => {
        this.bgMusic.volume = musicSlider.value / 100;
      });
    }
  }
}
