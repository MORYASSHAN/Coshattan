import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { loadHolograms } from "./holograms.js?v=2";
import { loadCity } from "./city.js?v=2";
import { makeAdsTexture } from "./ads.js";
import { createIntro, INTRO_REVEAL_AFTER } from "./intro.js";

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shaders already output display values

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 2e6);

// The sky (stars, galaxy, moon) lives in its own scene, drawn first as a backdrop,
// so the city can never be covered by stars or the moon.
const skyScene = new THREE.Scene();
const skyCamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 5000);

// Camera orbits the scene centre; one full scroll = one full 360 degree turn
const CENTER = new THREE.Vector3(0, 0, -17);
skyCamera.position.set(CENTER.x, 4, CENTER.z);
const UNITS_PER_METER = 5 / 1.87;                    // the man is 5 units = 1.87 m tall
const CITY_ORIGIN = new THREE.Vector3(0, 0, -16);    // Times Square on Broadway, where the man stands
let orbitDist = 28;

// Keep the man and both cars in frame on any screen shape
function fitCamera() {
  const halfWidth = 21;                                   // world units to keep visible at the models
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  orbitDist = Math.max(28, halfWidth / (tanHalf * camera.aspect));
}

function placeCamera(angle) {
  camera.position.set(CENTER.x + Math.sin(angle) * orbitDist, 4, CENTER.z + Math.cos(angle) * orbitDist);
  camera.lookAt(CENTER.x, 2.6, CENTER.z);
}
fitCamera();
placeCamera(0);

/* ---------- Sky (rotates around a celestial pole, like the Earth spinning) ---------- */
const POLE_ELEVATION = THREE.MathUtils.degToRad(32);           // pole star height above the horizon
const POLE_AXIS = new THREE.Vector3(0, Math.sin(POLE_ELEVATION), -Math.cos(POLE_ELEVATION)).normalize();
const SKY_SPEED = 0.012;                                         // radians per second

const skyGroup = new THREE.Group();
skyGroup.position.copy(skyCamera.position).setY(0);
skyScene.add(skyGroup);

/* Galaxy glow */
const BAND_NORMAL = new THREE.Vector3(0.8, 0.55, 0.12).normalize(); // tilt of the galaxy band

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(2000, 64, 32),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: { uBand: { value: BAND_NORMAL } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      varying float vWorldY;
      void main() {
        vDir = normalize(position);
        vWorldY = normalize(mat3(modelMatrix) * position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBand;
      varying vec3 vDir;
      varying float vWorldY;

      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float b = dot(d, uBand);                       // distance from band centre
        float band = exp(-b * b * 26.0);
        float core = exp(-b * b * 110.0);
        float clouds = fbm(d * 4.0);
        float dust = smoothstep(0.45, 0.75, fbm(d * 9.0 + 3.0)); // dark lanes
        float glow = band * (0.35 + 0.65 * clouds) * (1.0 - 0.45 * dust * core);
        vec3 col = mix(vec3(0.18, 0.2, 0.35), vec3(0.6, 0.55, 0.65), core) * glow * 0.6;
        col *= smoothstep(-0.01, 0.12, vWorldY);       // fade into the horizon
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }
    `,
  })
);
sky.renderOrder = -2;
skyGroup.add(sky);

/* Stars — full sphere so new ones rise over the horizon as the sky turns */
const STARS = 50000;
const pos = new Float32Array(STARS * 3);
const col = new Float32Array(STARS * 3);
const size = new Float32Array(STARS);
const twinkle = new Float32Array(STARS * 2); // phase, speed
const tints = [new THREE.Color(0xffffff), new THREE.Color(0xcfd9ff), new THREE.Color(0xfff1d6), new THREE.Color(0xaabfff)];
const v = new THREE.Vector3();
const u1 = new THREE.Vector3().crossVectors(BAND_NORMAL, new THREE.Vector3(0, 1, 0)).normalize();
const u2 = new THREE.Vector3().crossVectors(BAND_NORMAL, u1).normalize();

for (let n = 0; n < STARS; ) {
  if (n < STARS * 0.5) {
    // scattered across the whole sky
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (v.lengthSq() > 1 || v.lengthSq() < 0.01) continue;
    v.normalize();
  } else {
    // packed tightly along the galaxy band
    const a = Math.random() * Math.PI * 2;
    const spread = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 0.09;
    v.copy(u1).multiplyScalar(Math.cos(a)).addScaledVector(u2, Math.sin(a)).addScaledVector(BAND_NORMAL, spread).normalize();
  }
  v.multiplyScalar(1800);
  pos.set([v.x, v.y, v.z], n * 3);
  const c = tints[(Math.random() * tints.length) | 0];
  const k = 0.45 + Math.random() * 0.55;
  col.set([c.r * k, c.g * k, c.b * k], n * 3);
  size[n] = Math.random() < 0.015 ? 2.4 + Math.random() * 1.6 : 0.9 + Math.random() * 1.1;
  twinkle.set([Math.random() * Math.PI * 2, 0.6 + Math.random() * 2.4], n * 2);
  n++;
}

const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
starGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
starGeo.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkle, 2));

const starUniforms = { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() } };
const stars = new THREE.Points(
  starGeo,
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: starUniforms,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec2 aTwinkle;
      uniform float uTime;
      uniform float uPixel;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        float worldY = (modelMatrix * vec4(position, 1.0)).y;
        float tw = 0.55 + 0.45 * sin(uTime * aTwinkle.y + aTwinkle.x)
                        * sin(uTime * aTwinkle.y * 0.37 + aTwinkle.x * 2.0);
        vAlpha = tw * smoothstep(0.0, 40.0, worldY);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixel * 1.6 * (0.85 + 0.3 * tw);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
      }
    `,
  })
);
stars.renderOrder = -1;
skyGroup.add(stars);

/* ---------- Infinite grid floor ---------- */
const floorMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uCell: { value: 4.0 },
    uLineColor: { value: new THREE.Color(0x4d4d4d) },
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, -1000) },  // cursor position on the floor (x, z)
    uStrength: { value: 0 },                        // how strongly the floor is reacting
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uCell;
    uniform vec3 uLineColor;
    uniform float uTime;
    uniform vec2 uMouse;
    uniform float uStrength;
    varying vec3 vWorld;

    // Alias-free grid lines ("pristine grid", after Ben Golus): each line is filtered
    // to the pixel footprint, so the floor stays calm at any distance or camera motion.
    float pristineGrid(vec2 uv, float width) {
      vec2 lineWidth = vec2(width);
      vec4 uvDDXY = vec4(dFdx(uv), dFdy(uv));
      vec2 uvDeriv = vec2(length(uvDDXY.xz), length(uvDDXY.yw));
      vec2 drawWidth = clamp(lineWidth, uvDeriv, vec2(0.5));
      vec2 lineAA = uvDeriv * 1.5;
      vec2 gridUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
      vec2 g = smoothstep(drawWidth + lineAA, drawWidth - lineAA, gridUV);
      g *= clamp(lineWidth / drawWidth, 0.0, 1.0);
      g = mix(g, lineWidth, clamp(uvDeriv * 2.0 - 1.0, 0.0, 1.0));
      return mix(g.x, 1.0, g.y);
    }

    void main() {
      // Cursor reaction: smooth ripples that bend the grid around the cursor
      vec2 toMouse = vWorld.xz - uMouse;
      float r = length(toMouse);
      float falloff = exp(-r * 0.12) * uStrength;
      float wave = sin(r * 0.9 - uTime * 3.0) * falloff * smoothstep(0.0, 4.0, r);
      vec2 warped = vWorld.xz + (toMouse / max(r, 0.001)) * wave * 0.35;

      vec2 p = warped / uCell;
      float camH = cameraPosition.y;
      float line = pristineGrid(p, 0.018)              // thin core line
                 + pristineGrid(p, 0.09) * 0.22;       // soft glow around it
      // Far away the lines merge into a soft glow at the horizon (smooth, no flicker)
      float density = length(fwidth(p));
      line += smoothstep(0.12, 2.5, density) * 0.5 * (1.0 - smoothstep(40.0, 600.0, camH));
      // Larger grid levels take over when the camera is high up
      float big = max(pristineGrid(vWorld.xz / 40.0, 0.006) * smoothstep(60.0, 300.0, camH),
                  max(pristineGrid(vWorld.xz / 400.0, 0.004) * smoothstep(600.0, 3000.0, camH),
                      pristineGrid(vWorld.xz / 4000.0, 0.003) * smoothstep(6000.0, 30000.0, camH)));
      line = max(line, big * 0.8);

      // Soft light pooling under the cursor, brightest on the lines
      float light = exp(-r * r * 0.006) * uStrength;
      vec3 color = uLineColor * line * (1.0 + light * 1.5) + vec3(0.012) * light;
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});

// Subdivided so positions stay precise near the camera (one huge quad makes the lines jitter)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(2e6, 2e6, 256, 256), floorMaterial);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

/* ---------- Moon: rises half out of the infinite floor ---------- */
const MOON_RADIUS = 260;
const MOON_DIST = 1500;                 // nearer than the stars so they never draw over it
const moonTex = new THREE.TextureLoader().load("textures/moon.jpg");
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(MOON_RADIUS, 96, 64),
  new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: moonTex },
      uSun: { value: new THREE.Vector3(0.35, 0.25, 1).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        vUv = uv;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSun;
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        vec3 tex = texture2D(uMap, vUv).rgb;
        float light = 0.06 + 0.94 * smoothstep(-0.05, 0.6, dot(normalize(vNormalW), uSun));
        gl_FragColor = vec4(tex * light * vec3(0.97, 0.98, 1.0), 1.0);
      }
    `,
  })
);
moon.rotation.y = -1.2;
moon.position.set(CENTER.x, -MOON_RADIUS * 1.1, CENTER.z - MOON_DIST);
skyScene.add(moon);

// Soft glow around the moon (camera-facing; the floor still hides its lower half)
const moonGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(MOON_RADIUS * 5, MOON_RADIUS * 5),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0 * 2.5;   // 1.0 = moon edge
        float g = exp(-max(r - 1.0, 0.0) * 2.2) * smoothstep(0.9, 1.05, r);
        gl_FragColor = vec4(vec3(0.55, 0.6, 0.72) * g * 0.22, 1.0);
      }
    `,
  })
);
skyScene.add(moonGlow);

/* ---------- Smooth motion ---------- */
// Critically damped spring (like Unity's SmoothDamp): glides to the target without overshoot,
// so scroll steps turn into one continuous, eased movement.
function smoothDamp(current, target, state, smoothTime, dt) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * decay;
  return target + (change + temp) * decay;
}
const orbitSpring = { v: 0 }, tourSpring = { v: 0 };

/* ---------- Scroll → orbit + moonrise ---------- */
let scrollTarget = 0;   // 0 → 1 (one full turn)
let scroll = 0;
let started = false;
let mode = "orbit";     // "orbit" (around the man, moonrise) → "tour" (scroll through Manhattan)
let tourTarget = 0, tour = 0;   // 0 → 1 along the tour

function addScroll(amount) {
  if (mode === "orbit") scrollTarget = THREE.MathUtils.clamp(scrollTarget + amount, 0, 1);
  else if (mode === "tour") tourTarget = THREE.MathUtils.clamp(tourTarget + amount * 0.22, 0, 1);
}

window.addEventListener("wheel", (e) => {
  if (!started) return;
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  addScroll(px / 4000);
}, { passive: true });

let touchY = null;
window.addEventListener("touchstart", (e) => (touchY = e.touches[0].clientY), { passive: true });
window.addEventListener("touchmove", (e) => {
  if (!started || touchY === null) return;
  const y = e.touches[0].clientY;
  addScroll((touchY - y) / 1500);
  touchY = y;
}, { passive: true });

/* ---------- Cursor → floor ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
const mouseOnFloor = new THREE.Vector2(0, -1000);
const target = new THREE.Vector2();
let onFloor = false;
let pointerIn = false;
let energy = 0; // builds up while the cursor moves, settles when it stops

function castPointer() {
  raycaster.setFromCamera(pointer, camera);
  onFloor = pointerIn && !!raycaster.ray.intersectPlane(floorPlane, hit) && hit.distanceTo(camera.position) < 300;
}

window.addEventListener("pointermove", (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerIn = true;
  castPointer();
  if (onFloor) {
    if (mouseOnFloor.y < -900) mouseOnFloor.set(hit.x, hit.z);
    energy = Math.min(0.8, energy + 0.06);
  }
});
document.addEventListener("pointerleave", () => (pointerIn = onFloor = false));

/* ---------- Post-processing: glow ---------- */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(skyScene, skyCamera));
const mainPass = new RenderPass(scene, camera);
mainPass.clear = false;
mainPass.clearDepth = true;
composer.addPass(mainPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.3, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- Holograms: man + two cars ---------- */
const songBtns = [...document.querySelectorAll(".song")];
const loadingText = document.getElementById("loadingText");
const intro = document.getElementById("intro");
let holograms = null;

let city = null;
const dreamBtn = document.getElementById("dreamBtn");

// Only the opening (man + cars) blocks the song buttons. Manhattan starts downloading right
// away too, in parallel, so it is ready long before "See my dream". The chosen song streams.
const showLoading = (p) => (loadingText.textContent = `Loading ${Math.round(p * 100)}%`);
let cityProgress = 0, cityFailed = false;

const cityReady = loadCity(scene, { origin: CITY_ORIGIN, unitsPerMeter: UNITS_PER_METER, onProgress: (p) => (cityProgress = p) })
  .then(async (c) => {
    c.setAds(await makeAdsTexture());
    // upload the city to the GPU now (it is still below the floor, so nothing shows)
    c.group.visible = true;
    composer.render();
    c.group.visible = false;
    city = c;
  })
  .catch((err) => {
    console.error("City failed to load:", err);
    cityFailed = true;
  });

(async () => {
  try {
    holograms = await loadHolograms(scene, (p) => showLoading(p));
    loadingText.textContent = "";
    songBtns.forEach((b) => (b.disabled = false));
  } catch (err) {
    console.error(err);
    loadingText.textContent = "Failed to load";
  }
})();

/* ---------- Music: the visitor picks a song, which also starts the experience ---------- */
let music = null;
let startTime = 0;
function fadeIn(audio, to = 0.6, seconds = 3) {
  const t0 = performance.now();
  const step = (now) => {
    audio.volume = Math.min(to, (to * (now - t0)) / (seconds * 1000));
    if (audio.volume < to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const soundBtn = document.getElementById("soundBtn");
soundBtn.addEventListener("click", () => {
  if (!music) return;
  if (music.paused) music.play();
  else music.pause();
});

/* ---------- Title: full-screen words assemble, then one scroll flies through them ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let introWaiting = false;   // letters are up, waiting for the visitor's first scroll

function firstScroll() {
  return new Promise((resolve) => {
    const go = (e) => {
      if (e.type === "keydown" && !["ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) return;
      if (e.type === "wheel" && e.deltaY <= 0) return;
      ["wheel", "touchmove", "keydown"].forEach((ev) => window.removeEventListener(ev, go));
      resolve();
    };
    ["wheel", "touchmove", "keydown"].forEach((ev) => window.addEventListener(ev, go, { passive: true }));
  });
}

async function playTitle() {
  intro.classList.add("playing");             // song buttons fade; the world stays dark and blurred
  const titleFx = createIntro();
  await titleFx.assemble();
  introWaiting = true;
  await firstScroll();
  introWaiting = false;
  const passed = titleFx.passThrough();        // the words zoom up and rush past the screen...
  await wait(INTRO_REVEAL_AFTER * 1000);
  intro.classList.add("hide");                 // ...the world clears...
  await wait(500);
  holograms.start(clock.elapsedTime + 0.2);    // ...and the man and cars rise out of the floor
  await passed;
  await wait(400);                             // let that scroll gesture finish before orbiting
}

let titleRunning = false;
songBtns.forEach((btn) =>
  btn.addEventListener("click", () => {
    if (started || titleRunning || !holograms) return;
    titleRunning = true;
    music = new Audio(encodeURI(btn.dataset.src));   // streams while it plays
    music.loop = true;
    music.volume = 0;
    music.addEventListener("play", () => soundBtn.classList.remove("paused"));
    music.addEventListener("pause", () => soundBtn.classList.add("paused"));
    music.play().then(() => fadeIn(music)).catch((err) => console.warn("Music could not play:", err));
    soundBtn.classList.add("show");
    playTitle().then(() => {
      startTime = clock.elapsedTime;
      started = true;
    });
  })
);

/* ---------- The dream: Manhattan rises, then a scroll-driven tour ---------- */
// Same projection as the data preprocessing: meters around Times Square, avenues along -z
const LAT0 = 40.757982, LON0 = -73.985539, GRID = THREE.MathUtils.degToRad(29);
const KX = Math.cos(THREE.MathUtils.degToRad(LAT0)) * 111320, KY = 110540;
function geo([lat, lon], east = 0, north = 0, height = 0) {
  const e = (lon - LON0) * KX + east, n = (lat - LAT0) * KY + north;
  const x = e * Math.cos(GRID) - n * Math.sin(GRID);
  const z = -(e * Math.sin(GRID) + n * Math.cos(GRID));
  return new THREE.Vector3(CITY_ORIGIN.x + x * UNITS_PER_METER, height * UNITS_PER_METER, CITY_ORIGIN.z + z * UNITS_PER_METER);
}

const PLACES = {
  timesSquare: [40.757982, -73.985539],
  oneTimesSquare: [40.75642, -73.986236],
  rockefeller: [40.75874, -73.978674],
  centralParkTower: [40.76634, -73.98098],
  parkSouth: [40.766, -73.976],
  centralPark: [40.7745, -73.9665],
  bethesda: [40.774, -73.9708],
  reservoir: [40.7859, -73.9625],
  harlemMeer: [40.7975, -73.9555],
  gwBridge: [40.8533, -73.9527],
  hudsonRiver86: [40.787, -73.993],
  hudsonYards: [40.7538, -74.0012],
  westSide22: [40.7455, -74.0105],
  highLineSouth: [40.7398, -74.008],
  empireState: [40.74844, -73.985664],
  flatiron: [40.741061, -73.989699],
  washingtonSquare: [40.7312, -73.9971],
  oneWTC: [40.712742, -74.013382],
  memorial: [40.7115, -74.0134],
  harbor: [40.6985, -74.0215],
  liberty: [40.689247, -74.044502],
  battery: [40.6995, -74.004],
  brooklynBridge: [40.706086, -73.996864],
  eastRiver: [40.7489, -73.9625],
  chrysler: [40.751652, -73.975311],
};

// Offsets in the street grid: across the avenues, along them (+ = downtown), height (m)
function grid(place, across, along, height) {
  return geo(place, 0, 0, height).add(new THREE.Vector3(across * UNITS_PER_METER, 0, along * UNITS_PER_METER));
}

// Final wide shot, framed for the screen shape (narrow screens turn toward the moon and pull back)
const AERIAL = {
  target: CITY_ORIGIN.clone().add(new THREE.Vector3(350 * UNITS_PER_METER, 0, -1100 * UNITS_PER_METER)),
  dist: 13000 * UNITS_PER_METER,
  az: THREE.MathUtils.degToRad(24),
  el: THREE.MathUtils.degToRad(17),
};
function aerialPose() {
  const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  const az = Math.min(AERIAL.az, halfFov * 0.55);
  const dist = AERIAL.dist * Math.pow(Math.max(1, 1.6 / camera.aspect), 0.7);
  const pos = new THREE.Vector3(
    AERIAL.target.x + Math.sin(az) * Math.cos(AERIAL.el) * dist,
    AERIAL.target.y + Math.sin(AERIAL.el) * dist,
    AERIAL.target.z + Math.cos(az) * Math.cos(AERIAL.el) * dist
  );
  return [pos, AERIAL.target.clone()];
}

// Each stop: camera position, point it looks at, and an optional caption. Heights (m) stay
// above the towers and only drop low over open water or wide open squares.
let tourPos = null, tourLook = null, tourCaptions = [];
function buildTour() {
  const P = PLACES;
  const C = (title, line) => ({ title, line });
  const stops = [
    [camera.position.clone(), new THREE.Vector3(CENTER.x, 2.6, CENTER.z)],
    [grid(P.timesSquare, 0, -120, 22), geo(P.oneTimesSquare, 0, 0, 60),
      C("Times Square", "Broadway meets 7th Avenue — the crossroads of the world")],
    [grid(P.timesSquare, 0, 60, 35), grid(P.timesSquare, 0, -260, 40),
      C("Times Square", "Lit day and night by giant LED screens")],
    [grid(P.timesSquare, 0, 0, 300), geo(P.rockefeller, 0, 0, 200)],
    [geo(P.rockefeller, 250, -250, 330), geo(P.rockefeller, 0, 0, 220),
      C("Rockefeller Center", "30 Rock and the Top of the Rock observation deck")],
    [geo(P.centralParkTower, 350, -450, 520), geo(P.centralParkTower, 0, 0, 400),
      C("Billionaires' Row", "The world's slenderest supertall towers line 57th Street")],
    [geo(P.parkSouth, 0, 0, 380), geo(P.bethesda, 0, 0, 0),
      C("Central Park", "843 acres of green in the middle of Manhattan")],
    [geo(P.centralPark, 0, 0, 260), geo(P.reservoir, 0, 0, 0),
      C("Central Park", "The Reservoir, with the Met Museum on its eastern edge")],
    [geo(P.harlemMeer, 0, 0, 320), geo(P.gwBridge, 0, 0, 60),
      C("Harlem", "Uptown, with the George Washington Bridge in the distance")],
    [geo(P.hudsonRiver86, 0, 0, 300), geo(P.hudsonYards, 0, 0, 300)],
    [geo(P.hudsonYards, -500, 200, 360), geo(P.hudsonYards, 0, 0, 320),
      C("Hudson Yards", "The city's newest neighborhood, home of the Edge sky deck")],
    [geo(P.westSide22, 0, 0, 110), geo(P.highLineSouth, 0, 0, 10),
      C("The High Line", "An old elevated freight railway turned into a park")],
    [geo(P.empireState, -380, 260, 380), geo(P.empireState, 0, 0, 350),
      C("Empire State Building", "1931 · 443 m to the tip of its mast")],
    [geo(P.empireState, 330, 120, 410), geo(P.empireState, 0, 0, 370),
      C("Empire State Building", "For nearly 40 years, the tallest building in the world")],
    [geo(P.empireState, 220, -330, 360), geo(P.flatiron, 0, 0, 60)],
    [geo(P.flatiron, 0, 260, 170), geo(P.flatiron, 0, 0, 40),
      C("Flatiron Building", "1902 · The triangular icon on Madison Square")],
    [geo(P.washingtonSquare, 0, 450, 200), geo(P.washingtonSquare, 0, 0, 0),
      C("Washington Square Park", "The heart of Greenwich Village")],
    [geo(P.oneWTC, 650, 700, 520), geo(P.oneWTC, 0, 0, 450),
      C("One World Trade Center", "541 m · The tallest building in the Western Hemisphere")],
    [geo(P.oneWTC, 380, -300, 610), geo(P.oneWTC, 0, 0, 480),
      C("One World Trade Center", "Its spire reaches a symbolic 1,776 feet")],
    [geo(P.memorial, -250, -250, 380), geo(P.memorial, 0, 0, 0),
      C("9/11 Memorial", "Two reflecting pools where the Twin Towers stood")],
    [geo(P.harbor, 0, 0, 220), geo(P.liberty, 0, 0, 60),
      C("New York Harbor", "Where ships once brought millions of immigrants")],
    [geo(P.liberty, 150, -120, 70), geo(P.liberty, 0, 0, 72),
      C("Statue of Liberty", "A gift from France, 1886 · 93 m from ground to torch")],
    [geo(P.liberty, -180, -260, 75), geo(P.oneWTC, 0, 0, 250),
      C("Statue of Liberty", "Lifting her torch toward Lower Manhattan")],
    [geo(P.battery, 0, 0, 150), geo(P.brooklynBridge, 0, 0, 40)],
    [geo(P.brooklynBridge, 500, 150, 150), geo(P.brooklynBridge, 0, 0, 50),
      C("Brooklyn Bridge", "1883 · The first steel-wire suspension bridge")],
    [geo(P.eastRiver, 0, 0, 330), geo(P.chrysler, 0, 0, 280),
      C("Chrysler Building", "Art Deco crown of Midtown, beside the United Nations")],
    [...aerialPose(), C("Manhattan", "21.6 km long, 3.7 km at its widest, home to 1.6 million people")],
  ];
  tourPos = new THREE.CatmullRomCurve3(stops.map((s) => s[0]), false, "centripetal");
  tourLook = new THREE.CatmullRomCurve3(stops.map((s) => s[1]), false, "centripetal");
  tourCaptions = stops.map((s) => s[2] || null);
}

const captionEl = document.getElementById("caption");
const captionTitle = captionEl.querySelector(".cap-title");
const captionLine = captionEl.querySelector(".cap-line");
let captionShown = null;
function updateCaption() {
  const f = tour * (tourCaptions.length - 1);
  const i = Math.round(f);
  const cap = Math.abs(f - i) < 0.42 ? tourCaptions[i] : null;
  if (cap !== captionShown) {
    captionShown = cap;
    captionEl.classList.remove("show");
    if (cap) {
      captionTitle.textContent = cap.title;
      captionLine.textContent = cap.line;
      requestAnimationFrame(() => captionEl.classList.add("show"));
    }
  }
}

const scrollHint = document.getElementById("scrollHint");
let dreamStart = 0;

dreamBtn.addEventListener("click", () => {
  if (mode !== "orbit" || !city || !dreamBtn.classList.contains("show")) return;
  dreamBtn.classList.remove("show");
  mode = "tour";
  dreamStart = clock.elapsedTime;
  city.rise(dreamStart);
  buildTour();
  tourTarget = tour = 0;
});

const lookAt = new THREE.Vector3();
const lookSmooth = new THREE.Vector3();
let lookReady = false;
function updateCameraMode(t, dt) {
  if (mode === "orbit") {
    scroll = smoothDamp(scroll, scrollTarget, orbitSpring, 0.7, dt);
    placeCamera(scroll * Math.PI * 2);
    scrollHint.classList.toggle("show", introWaiting || (started && t - startTime > 3.5 && scrollTarget < 0.02));
    return;
  }
  // Tour: the scroll position moves the camera along the path (smoothed so it glides)
  tour = THREE.MathUtils.clamp(smoothDamp(tour, tourTarget, tourSpring, 1.1, dt), 0, 1);
  tourPos.getPoint(tour, camera.position);
  tourLook.getPoint(tour, lookAt);
  // the aim follows a touch behind the position, which softens every turn
  if (!lookReady) { lookSmooth.copy(lookAt); lookReady = true; }
  lookSmooth.lerp(lookAt, 1 - Math.exp(-dt * 3.5));
  camera.lookAt(lookSmooth);
  // keep depth precision good at every height
  const near = THREE.MathUtils.clamp(camera.position.y * 0.02, 0.5, 300);
  if (Math.abs(near - camera.near) > 0.01) { camera.near = near; camera.updateProjectionMatrix(); }
  // invite scrolling once the city has risen around the man; hide it once they do
  scrollHint.classList.toggle("show", t - dreamStart > 3 && tourTarget < 0.01);
  updateCaption();
}

/* ---------- Loop ---------- */
const clock = new THREE.Clock();
const fu = floorMaterial.uniforms;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  starUniforms.uTime.value = t;
  skyGroup.quaternion.setFromAxisAngle(POLE_AXIS, t * SKY_SPEED);

  // Orbit the scene and raise the moon with scroll; later the dream flight / aerial orbit
  updateCameraMode(t, dt);
  const rise = mode === "orbit" ? THREE.MathUtils.smoothstep(scroll, 0.3, 0.95) : 1;
  moon.position.y = THREE.MathUtils.lerp(-MOON_RADIUS * 1.1, 0, rise);
  skyCamera.quaternion.copy(camera.quaternion);   // the sky turns with the view but never moves
  moonGlow.position.copy(moon.position);
  moonGlow.lookAt(skyCamera.position);
  // "See my dream" appears once the moon is up; if Manhattan is still loading it shows progress
  if (mode === "orbit" && rise > 0.98 && scroll > 0.97) {
    dreamBtn.classList.add("show");
    dreamBtn.disabled = !city;
    const label = city ? "See my dream"
      : cityFailed ? "Couldn't load the city — refresh to retry"
      : `Loading Manhattan ${Math.round(cityProgress * 100)}%`;
    if (dreamBtn.textContent !== label) dreamBtn.textContent = label;
  } else if (mode === "orbit") dreamBtn.classList.remove("show");

  // Follow the cursor smoothly; react while moving, keep a faint glow while resting
  if (pointerIn) castPointer();
  if (onFloor) mouseOnFloor.lerp(target.set(hit.x, hit.z), 1 - Math.exp(-dt * 8));
  energy = Math.max(onFloor ? 0.12 : 0, energy - dt * 0.6);
  fu.uStrength.value += (energy - fu.uStrength.value) * (1 - Math.exp(-dt * 5));
  fu.uMouse.value.copy(mouseOnFloor);
  fu.uTime.value = t;
  holograms?.update(dt, t);
  city?.update(t);
  composer.render();
  requestAnimationFrame(tick);
}

window.addEventListener("resize", () => {
  camera.aspect = skyCamera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  skyCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  fitCamera();
  if (mode === "tour" && tourPos) {   // re-frame the final shot for the new screen shape
    const pts = tourPos.points, looks = tourLook.points;
    const [p, l] = aerialPose();
    pts[pts.length - 1].copy(p);
    looks[looks.length - 1].copy(l);
  }
});

tick();
