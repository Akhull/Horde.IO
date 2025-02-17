// public/js/mapgenerator/mapgenerator.js
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";
import { EXRLoader } from "https://unpkg.com/three@0.128.0/examples/jsm/loaders/EXRLoader.js";

/**
 * Minimale Perlin Noise-Implementierung (2D)
 */
const noise = (() => {
  const grad3 = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
  ];
  const p = [];
  for (let i = 0; i < 256; i++) {
    p[i] = Math.floor(Math.random() * 256);
  }
  const perm = [];
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
  }
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function lerp(t, a, b) {
    return a + t * (b - a);
  }
  function dot(g, x, y) {
    return g[0] * x + g[1] * y;
  }
  function perlin2(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x = x - Math.floor(x);
    y = y - Math.floor(y);
    const u = fade(x);
    const v = fade(y);
    const aa = perm[X + perm[Y]] % 12;
    const ab = perm[X + perm[Y + 1]] % 12;
    const ba = perm[X + 1 + perm[Y]] % 12;
    const bb = perm[X + 1 + perm[Y + 1]] % 12;
    const x1 = lerp(u, dot(grad3[aa], x, y), dot(grad3[ba], x - 1, y));
    const x2 = lerp(u, dot(grad3[ab], x, y - 1), dot(grad3[bb], x - 1, y - 1));
    return lerp(v, x1, x2);
  }
  return { perlin2 };
})();

/**
 * MapGenerator: Erzeugt eine Map bestehend aus Terrain und Wasser.
 *
 * Nutze getMap() um eine THREE.Group mit allen Map-Objekten zu erhalten.
 * Mit update(delta) kannst du (falls gewünscht) Animationen wie den Wasser-Effekt aktualisieren.
 */
class MapGenerator {
  constructor(options = {}) {
    // Standardwerte; diese lassen sich über das options-Objekt überschreiben.
    this.options = Object.assign({
      terrainSize: 10000,
      terrainSegments: 256,
      bias: 20.0,
      waterLevel: -2.0,
      repeatScale: 20.0,
      beachToGrassEnd: 5.0,
      grassToRockStart: 50.0,
      grassToRockEnd: 70.0,
      waterColor: 0x00008B,
      waterOpacity: 0.8,
      envMapPath: '/js/mapgenerator/kloofendal_48d_partly_cloudy_puresky_1k.exr',
      sandTexturePath: '/js/mapgenerator/sand.jpg',
      grassTexturePath: '/js/mapgenerator/gras.jpg',
      rockTexturePath: '/js/mapgenerator/stein.jpg'
    }, options);

    // Gruppe, die das Terrain und Wasser enthält.
    this.group = new THREE.Group();

    // Uniforms für den Wasser-Shader
    this.waterUniforms = {
      time: { value: 0.0 },
      color: { value: new THREE.Color(this.options.waterColor) },
      opacity: { value: this.options.waterOpacity },
      lightDir: { value: new THREE.Vector3(50.0, 100.0, 50.0).normalize() },
      envMap: { value: null }
    };

    // Loader initialisieren
    this.textureLoader = new THREE.TextureLoader();
    this.exrLoader = new EXRLoader();

    // Ressourcen laden und Map erstellen
    this.loadEnvironmentMap();
    this.loadTerrainTextures();
    this.generateTerrain();
    this.generateWater();
  }

  loadEnvironmentMap() {
    // Erzeugt einen temporären Renderer + PMREMGenerator, um den EXR als envMap aufzubereiten.
    const renderer = new THREE.WebGLRenderer();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    this.exrLoader.load(this.options.envMapPath, (texture) => {
      const envMap = pmremGenerator.fromEquirectangular(texture).texture;
      this.waterUniforms.envMap.value = envMap.clone();
      texture.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
    });
  }

  loadTerrainTextures() {
    // Terrain-Texturen laden
    this.sandTexture = this.textureLoader.load(this.options.sandTexturePath);
    this.grassTexture = this.textureLoader.load(this.options.grassTexturePath);
    this.rockTexture  = this.textureLoader.load(this.options.rockTexturePath);
    [this.sandTexture, this.grassTexture, this.rockTexture].forEach(tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    });
  }

  generateTerrain() {
    const { terrainSize, terrainSegments, bias, waterLevel, repeatScale, beachToGrassEnd, grassToRockStart, grassToRockEnd } = this.options;

    const terrainUniforms = {
      beachTexture: { value: this.sandTexture },
      grassTexture: { value: this.grassTexture },
      rockTexture:  { value: this.rockTexture },
      beachToGrassStart: { value: waterLevel },
      beachToGrassEnd:   { value: beachToGrassEnd },
      grassToRockStart:  { value: grassToRockStart },
      grassToRockEnd:    { value: grassToRockEnd },
      repeatScale:       { value: repeatScale },
      waterLevel:        { value: waterLevel }
    };

    const terrainVertexShader = `
      varying vec2 vUv;
      varying float vHeight;
      void main() {
        vUv = uv;
        vHeight = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const terrainFragmentShader = `
      uniform sampler2D beachTexture;
      uniform sampler2D grassTexture;
      uniform sampler2D rockTexture;
      uniform float beachToGrassStart;
      uniform float beachToGrassEnd;
      uniform float grassToRockStart;
      uniform float grassToRockEnd;
      uniform float repeatScale;
      uniform float waterLevel;
      varying vec2 vUv;
      varying float vHeight;
      void main(){
        vec2 uvScaled = vUv * repeatScale;
        vec4 sandColor  = texture2D(beachTexture, uvScaled);
        vec4 grassColor = texture2D(grassTexture, uvScaled);
        vec4 rockColor  = texture2D(rockTexture, uvScaled);
        
        float sandWeight = clamp(1.0 - smoothstep(beachToGrassStart, beachToGrassEnd, vHeight), 0.0, 1.0);
        float rockWeight = clamp(smoothstep(grassToRockStart, grassToRockEnd, vHeight), 0.0, 1.0);
        float grassWeight = 1.0 - sandWeight - rockWeight;
        vec4 color = sandWeight * sandColor + grassWeight * grassColor + rockWeight * rockColor;
        if(vHeight < waterLevel){
          color.rgb *= 0.5;
        }
        gl_FragColor = color;
      }
    `;

    const terrainMaterial = new THREE.ShaderMaterial({
      uniforms: terrainUniforms,
      vertexShader: terrainVertexShader,
      fragmentShader: terrainFragmentShader,
      side: THREE.DoubleSide
    });

    const terrainGeometry = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
    terrainGeometry.rotateX(-Math.PI / 2);

    // Terrain-Höhen mittels Perlin Noise variieren
    const posAttr = terrainGeometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++){
      const vertex = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      const n1 = noise.perlin2(vertex.x * 0.001, vertex.z * 0.001);
      const n2 = noise.perlin2(vertex.x * 0.01, vertex.z * 0.01);
      vertex.y = (n1 * 0.8 + n2 * 0.2) * 100.0 + bias;
      posAttr.setY(i, vertex.y);
    }
    terrainGeometry.computeVertexNormals();

    this.terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
    this.group.add(this.terrainMesh);
  }

  generateWater() {
    const { terrainSize, waterLevel } = this.options;

    const waterVertexShader = `
      uniform float time;
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vec3 pos = position;
        pos.y += sin(pos.x * 0.01 + time * 0.5) * 1.5;
        pos.y += cos(pos.z * 0.01 + time * 0.5) * 1.5;
        vPos = pos;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;

    const waterFragmentShader = `
      uniform vec3 color;
      uniform float opacity;
      uniform vec3 lightDir;
      uniform samplerCube envMap;
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNormal;
      void main(){
        vec3 baseColor = color;
        vec3 viewDir = normalize(-vPos);
        float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
        vec3 reflectDir = reflect(-viewDir, vNormal);
        vec3 envColor = textureCube(envMap, reflectDir).rgb;
        vec3 finalColor = mix(baseColor, envColor, 0.2 * fresnel);
        gl_FragColor = vec4(finalColor, opacity);
      }
    `;

    const waterGeometry = new THREE.PlaneGeometry(terrainSize, terrainSize, 50, 50);
    waterGeometry.rotateX(-Math.PI / 2);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      transparent: true,
      side: THREE.DoubleSide
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, this.waterMaterial);
    this.waterMesh.position.y = waterLevel;
    this.group.add(this.waterMesh);
  }

  /**
   * Falls du Animationen (z. B. den Wasser-Effekt) integrieren möchtest,
   * rufe diese Methode in der Haupt-Render-Schleife mit dem entsprechenden Delta (Sekunden) auf.
   */
  update(delta) {
    this.waterUniforms.time.value += delta;
  }

  /**
   * Liefert die THREE.Group zurück, die das generierte Terrain und Wasser enthält.
   */
  getMap() {
    return this.group;
  }
}

export default MapGenerator;
