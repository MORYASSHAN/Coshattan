import * as THREE from "three";

/*
  The story, written into the city. Each sentence lives at one place and stays there:
  a banner across Broadway, a rooftop sign, on a tower's face, across the park. Words are
  white with a soft dark halo (readable over any building), sized to fill most of the screen
  at their stop, fade in as you approach, write themselves on once with a gentle light wipe,
  then stay put as the camera moves past.
*/

const FONT = '400 {S}px "Anton", "Arial Narrow", Impact, sans-serif';

// Sentence → texture: centered lines, white, a soft glow
function textTexture(lines, { size = 160, gap = 0.28 } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = FONT.replace("{S}", size);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${Math.round(size * 0.06)}px`;
  const pad = size * 0.5;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const lineH = size * (1 + gap);
  c.width = Math.min(8192, Math.ceil(w + pad * 2));
  c.height = Math.ceil(lines.length * lineH + pad * 2);
  ctx.font = FONT.replace("{S}", size);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${Math.round(size * 0.06)}px`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => {
    const y = pad + lineH * (i + 0.5);
    // a soft dark halo behind the letters, like subtitles: readable over any building
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = size * 0.45;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillText(l, c.width / 2, y);
    ctx.fillText(l, c.width / 2, y);
    // the words themselves: white with a gentle glow
    ctx.shadowColor = "rgba(255,255,255,0.55)";
    ctx.shadowBlur = size * 0.15;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(l, c.width / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uReveal;     // 0 → 1: the words write themselves on, left to right
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    float edge = uReveal * 1.25 - 0.12;
    float shown = smoothstep(edge + 0.1, edge - 0.02, vUv.x);
    float glint = exp(-pow((vUv.x - edge) * 18.0, 2.0)) * (1.0 - uReveal);   // light at the writing edge
    gl_FragColor = vec4(c.rgb + glint * 0.8, c.a * uOpacity * max(shown, glint));
  }
`;

function material(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uOpacity: { value: 0 }, uReveal: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,          // buildings never cut through the words
  });
}

export function createStory(scene, camera) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const items = [];
  const tanHalf = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // stop: the tour stop this sentence belongs to; it shows while you approach and fades as you leave
  function add(mesh, { stop, until = stop, opacity = 0.92 }) {
    mesh.userData = { stop, until, opacity, reveal: 0, started: false };
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    group.add(mesh);
    items.push(mesh);
  }

  // width that fills `fill` of the screen for a reader at distance `dist`, never taller than 30% of it
  function fitWidth(dist, aspect, fill) {
    const viewH = 2 * dist * tanHalf();
    return Math.min(viewH * camera.aspect * fill, viewH * 0.3 * aspect);
  }

  return {
    // An upright sentence standing at `at`, turned to face `from` (only turning left/right, never tilted)
    wall(lines, { at, from, stop, until, fill = 0.7, opacity }) {
      const { tex, aspect } = textTexture(lines);
      const width = fitWidth(at.distanceTo(from), aspect, fill);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / aspect), material(tex));
      mesh.position.copy(at);
      mesh.rotation.y = Math.atan2(from.x - at.x, from.z - at.z);
      add(mesh, { stop, until, opacity });
    },
    // A sentence lying flat (street, roof, park), reading upright for someone at `from`
    ground(lines, { at, from, stop, fill = 0.7, opacity }) {
      const { tex, aspect } = textTexture(lines);
      const dist = at.distanceTo(from);
      const width = fitWidth(dist, aspect, fill);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / aspect), material(tex));
      mesh.position.copy(at);
      // lay it flat, then turn it so the top of the text points away from the reader
      const dx = at.x - from.x, dz = at.z - from.z;
      mesh.rotation.order = "YXZ";
      mesh.rotation.set(-Math.PI / 2, Math.atan2(-dx, -dz), 0);
      add(mesh, { stop, opacity });
    },
    show() { group.visible = true; },
    // f: position along the tour, in stops
    update(cam, dt, f) {
      for (const m of items) {
        const u = m.userData;
        const vis = THREE.MathUtils.smoothstep(f, u.stop - 1.2, u.stop - 0.55) * (1 - THREE.MathUtils.smoothstep(f, u.until + 0.45, u.until + 0.95));
        m.material.uniforms.uOpacity.value = vis * u.opacity;
        // write on once, the first time it comes into view; after that it simply stays
        if (vis > 0.15) u.started = true;
        if (u.started) u.reveal = Math.min(1, u.reveal + dt / 1.6);
        m.material.uniforms.uReveal.value = u.reveal;
        m.visible = vis > 0.001;
      }
    },
  };
}
