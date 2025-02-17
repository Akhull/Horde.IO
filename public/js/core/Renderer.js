// public/js/core/Renderer.js
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";
import { CONFIG } from "./config.js";

export class Renderer {
  constructor(game) {
    this.game = game;
    this.canvas = game.canvas;
    
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    this.scene.add(directionalLight);
    
    // Übergib Szene und Kamera an das Game.
    this.game.scene = this.scene;
    this.game.camera = this.camera;
  }
  
  setSize(width, height) {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  
  draw() {
    if (this.game.playerKing) {
      const cameraOffset = new THREE.Vector3(0, 400, 400);
      this.camera.position.copy(this.game.playerKing.position).add(cameraOffset);
      this.camera.lookAt(this.game.playerKing.position);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
