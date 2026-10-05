import * as THREE from "three";

/*
  Manhattan, drawn in thin lines.
  Data (preprocessed into /data):
  - Building footprints + roof heights: NYC Open Data "Building Footprints" (NYC DoITT)
  - Street centerlines (with bridge levels): NYC Open Data "Centerline (CSCL)"
  - Shoreline: NYC Open Data "Borough Boundaries"; parks: "Parks Properties"; water: "NYC Planimetric Hydrography"
  Coordinates are meters, Times Square (Broadway & 7th Ave) at the origin, avenues along -z.
*/

const RISE_SECONDS = 2.4;      // how long one building takes to rise
const WAVE_SPEED = 2200;       // meters per second the rising wave travels outward

const shared = {
  uAds: { value: null },       // billboard slides (see ads.js)
  uHasAds: { value: 0 },
  uTime: { value: 0 },
  uStart: { value: 1e9 },      // time the city starts rising
  uColor: { value: new THREE.Color(0xc8dcff) },
  uBright: { value: 0.5 },
};

const RISE_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uStart;
  float riseOf(float dist) {
    float k = clamp((uTime - uStart - dist / ${WAVE_SPEED.toFixed(1)}) / ${RISE_SECONDS.toFixed(1)}, 0.0, 1.0);
    return 1.0 - pow(1.0 - k, 3.0);
  }
`;

const WALL_VERT = /* glsl */ `
  ${RISE_GLSL}
  attribute vec3 aWall;   // distance along the wall (m), wall length (m), LED screen seed (0 = none)
  attribute vec4 aInfo;   // base height, wall top, distance from Times Square, building top
  varying vec3 vWall;
  varying vec3 vInfo;
  varying float vH;
  varying float vY;
  varying float vRise;
  varying float vFade;
  void main() {
    float r = riseOf(aInfo.z);
    vec3 p = position;
    p.y -= (1.0 - r) * (aInfo.w + 2.0);   // slide up out of the floor
    vWall = aWall;
    vInfo = aInfo.xyz;
    vH = position.y;
    vY = p.y;
    vRise = r;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vFade = mix(1.0, 0.28, smoothstep(1500.0, 45000.0, length(cameraPosition - world.xyz)));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WALL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright;
  uniform float uTime;
  uniform sampler2D uAds;
  uniform float uHasAds;
  varying vec3 vWall;
  varying vec3 vInfo;
  varying float vH;
  varying float vY;
  varying float vRise;
  varying float vFade;

  float lineAt(float d, float fw) { return 1.0 - smoothstep(0.5, 1.4, d / fw); }
  float repeatLine(float x, float s) {
    float fw = fwidth(x);
    float d = abs(fract(x / s - 0.5) - 0.5) * s;
    return lineAt(d, fw) * (1.0 - smoothstep(0.12, 0.4, fw / s));   // fade when denser than pixels
  }
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec3 hue(float h) { return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))); }

  // Animated LED billboard (Times Square facades)
  vec3 ledScreen(vec2 q, vec2 size, float seed, float fu, float fh) {
    vec2 uv = q / size;
    float t = uTime * 0.5 + seed * 37.0;
    float scene = floor(t / 7.0);
    vec3 a = hue(fract(seed * 3.7 + scene * 0.37));
    vec3 b = hue(fract(seed * 5.3 + scene * 0.61 + 0.33));
    vec3 col;
    if (uHasAds > 0.5 && seed > 0.38) {
      // an ad slide, letterboxed to keep its 2:1 shape on any screen
      float slide = mod(scene + floor(seed * 4.0), 4.0);
      float aspect = size.x / size.y;
      vec2 st = uv;
      if (aspect > 2.0) st.x = 0.5 + (uv.x - 0.5) * (aspect / 2.0);
      else st.y = 0.5 + (uv.y - 0.5) * (2.0 / aspect);
      float inside = step(0.0, st.x) * step(st.x, 1.0) * step(0.0, st.y) * step(st.y, 1.0);
      st = clamp(st, 0.003, 0.997);
      vec2 cellOrigin = vec2(mod(slide, 2.0), floor(slide / 2.0));
      col = texture2D(uAds, (cellOrigin + vec2(st.x, 1.0 - st.y)) * 0.5).rgb * inside * 1.7;
    } else {
      float type = mod(scene + floor(seed * 5.0), 4.0);
      float pat;
      if (type < 1.0) pat = 0.5 + 0.5 * sin(uv.x * 6.0 + t * 2.5);                                  // sweeping wave
      else if (type < 2.0) pat = smoothstep(0.35, 0.65, fract(uv.y * 3.0 - t * 0.8));               // rolling bands
      else if (type < 3.0) pat = 1.0 - smoothstep(0.0, 0.6, length(uv - vec2(0.5 + 0.3 * sin(t), 0.5)));   // moving glow
      else pat = step(0.5, fract(uv.x * 2.0 + floor(uv.y * 6.0) * 0.5 - t * 0.6));                  // ticker blocks
      col = mix(a, b, pat);
    }
    // LED pixels, 25 cm pitch; blend to their average when smaller than a pixel
    vec2 led = q * 4.0;
    vec2 fwl = fwidth(led);
    float dots = smoothstep(0.48, 0.3, length(fract(led) - 0.5));
    dots = mix(dots, 0.55, smoothstep(0.3, 0.7, max(fwl.x, fwl.y)));
    float frame = max(lineAt(min(q.x, size.x - q.x), fu), lineAt(min(q.y, size.y - q.y), fh));
    return col * dots * 0.5 + uColor * frame * 0.5;
  }

  void main() {
    if (vY < 0.0 || vRise <= 0.0) discard;   // still below the floor
    float u = vWall.x, L = vWall.y;
    float fu = fwidth(u), fh = fwidth(vH);
    float edges = max(
      lineAt(min(u, L - u), fu),
      max(lineAt(abs(vH - vInfo.y), fh), lineAt(abs(vH - vInfo.x), fh))
    );
    float inside = step(vInfo.x + 0.5, vH) * step(vH, vInfo.y - 0.5);

    // Times Square LED screens
    vec3 screen = vec3(0.0);
    float onScreen = 0.0;
    if (vWall.z > 0.0) {
      // screens are sized to the ads' 2:1 shape (up to 45 m tall)
      float y0 = 7.0, y1 = min(vInfo.y - 1.5, y0 + clamp((L - 2.4) * 0.5, 6.0, 45.0));
      if (u > 1.2 && u < L - 1.2 && vH > y0 && vH < y1) {
        onScreen = 1.0;
        screen = ledScreen(vec2(u - 1.2, vH - y0), vec2(L - 2.4, y1 - y0), vWall.z, fu, fh);
      }
    }

    float floors = repeatLine(vH - vInfo.x, 3.8) * inside * (1.0 - onScreen);
    float windows = repeatLine(u, 1.9) * inside * step(1.0, u) * step(1.0, L - u) * (1.0 - onScreen);

    // Night windows: a few lit at random, small and steady; far away they blend
    // into a faint even glow instead of sparkling
    vec2 w = vec2(u / 1.9, (vH - vInfo.x) / 3.8);
    vec2 cell = floor(w), f = fract(w), fw = fwidth(w);
    float rnd = hash13(vec3(cell, vInfo.z * 0.37 + floor(L)));
    float lit = step(0.8, rnd) * (0.55 + 2.2 * (rnd - 0.8));   // ~20% lit, some brighter than others
    float rx = smoothstep(0.3 - fw.x, 0.3 + fw.x, f.x) * (1.0 - smoothstep(0.7 - fw.x, 0.7 + fw.x, f.x));
    float ry = smoothstep(0.32 - fw.y, 0.32 + fw.y, f.y) * (1.0 - smoothstep(0.68 - fw.y, 0.68 + fw.y, f.y));
    float far = smoothstep(0.2, 0.55, max(fw.x, fw.y));
    float glow = mix(rx * ry * lit, 0.2 * 0.15, far)
               * inside * step(4.0, vH - vInfo.x) * step(1.0, u) * step(1.0, L - u) * (1.0 - onScreen);
    vec3 warm = mix(vec3(1.0, 0.76, 0.38), vec3(1.0, 0.9, 0.7), step(0.82, hash13(vec3(cell.yx, vInfo.z))));

    float seam = exp(-vY * 0.9) * (1.0 - vRise) * 2.0;    // glow where it cuts through the floor
    float i = (edges * 1.0 + floors * 0.34 + windows * 0.16) * vFade + seam;
    vec3 color = (uColor * i + warm * glow * 1.5) * uBright + screen * smoothstep(0.6, 1.0, vRise);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Black, depth-writing copy: buildings hide whatever is behind them
const SOLID_FRAG = /* glsl */ `
  varying float vY;
  varying float vRise;
  void main() {
    if (vY < 0.0 || vRise <= 0.0) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;

const ROOF_LINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright;
  varying float vY;
  varying float vRise;
  varying float vFade;
  void main() {
    if (vY < 0.0 || vRise <= 0.0) discard;
    gl_FragColor = vec4(uColor * 0.95 * vFade * uBright, 1.0);
  }
`;

const LINE_VERT = /* glsl */ `
  ${RISE_GLSL}
  attribute float aCat;
  varying float vAlpha;
  varying float vCat;
  void main() {
    float r = riseOf(length(position.xz));
    vec3 p = position;
    p.y *= r;                                  // bridges lift into place
    vAlpha = r;
    vCat = aCat;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_Position.z -= 0.0004 * gl_Position.w;   // sit just above the grid floor at any distance
  }
`;

const LINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright;
  varying float vAlpha;
  varying float vCat;
  void main() {
    if (vAlpha <= 0.0) discard;
    // 0 street curbs, 1 paths, 2 shoreline, 3 parks, 4 water, 5 bridges/viaducts
    float b = vCat < 0.5 ? 0.30 : vCat < 1.5 ? 0.16 : vCat < 2.5 ? 0.8 : vCat < 3.5 ? 0.38 : vCat < 4.5 ? 0.5 : 0.6;
    vec3 c = vCat > 3.5 && vCat < 4.5 ? vec3(0.6, 0.78, 1.0) : uColor;
    gl_FragColor = vec4(c * b * vAlpha * uBright, 1.0);
  }
`;

// Walls around the Times Square bowtie that face the square get an LED screen.
// (x = across the avenues, z = along them, + is downtown; Times Square at the origin)
function timesSquareScreen(ax, az, bx, bz, L) {
  if (L < 6) return 0;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  if (Math.abs(mx) > 80 || mz < -230 || mz > 290) return 0;
  const nx = (bz - az) / L, nz = -(bx - ax) / L;              // outward normal
  const tx = -mx, tz = -mz * 0.5, tl = Math.hypot(tx, tz) || 1; // toward the square
  if ((nx * tx + nz * tz) / tl < 0.35) return 0;
  // stable pseudo-random seed per wall
  const h = Math.sin(mx * 12.9898 + mz * 78.233) * 43758.5453;
  return 0.05 + 0.95 * (h - Math.floor(h));
}

function buildBuildings(buf) {
  const head = new Uint32Array(buf, 0, 3);
  const [nB, nR, nV] = head;
  let o = 12;
  const meta = new Float32Array(buf, o, nB * 4); o += nB * 16;
  const ringStart = new Uint32Array(buf, o, nB + 1); o += (nB + 1) * 4;
  const vertStart = new Uint32Array(buf, o, nR + 1); o += (nR + 1) * 4;
  const verts = new Float32Array(buf, o, nV * 2);

  const nWalls = nV; // one wall per ring edge
  const pos = new Float32Array(nWalls * 4 * 3);
  const wall = new Float32Array(nWalls * 4 * 3);
  const info = new Float32Array(nWalls * 4 * 4);
  const index = new Uint32Array(nWalls * 6);
  let w = 0;

  const roofPos = [], roofInfo = [], roofIndex = [];
  const edgePos = [], edgeInfo = [];   // hip edges of pointed roofs, drawn as lines
  let roofV = 0;

  for (let b = 0; b < nB; b++) {
    const h = meta[b * 4], minH = meta[b * 4 + 1], roofH = meta[b * 4 + 2], roofShape = meta[b * 4 + 3];
    const top = h - roofH;
    const r0 = ringStart[b], r1 = ringStart[b + 1];
    // distance of the building from Times Square (drives the rising wave)
    const fx = verts[vertStart[r0] * 2], fz = verts[vertStart[r0] * 2 + 1];
    const dist = Math.hypot(fx, fz);

    const contour = [], holes = [];
    for (let r = r0; r < r1; r++) {
      const v0 = vertStart[r], v1 = vertStart[r + 1], n = v1 - v0;
      const ring = [];
      for (let i = 0; i < n; i++) {
        const ax = verts[(v0 + i) * 2], az = verts[(v0 + i) * 2 + 1];
        const j = v0 + ((i + 1) % n);
        const bx = verts[j * 2], bz = verts[j * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const vi = w * 4;
        pos.set([ax, minH, az, bx, minH, bz, bx, top, bz, ax, top, az], vi * 3);
        const scr = r === r0 && top > 14 ? timesSquareScreen(ax, az, bx, bz, L) : 0;
        wall.set([0, L, scr, L, L, scr, L, L, scr, 0, L, scr], vi * 3);
        for (let k = 0; k < 4; k++) info.set([minH, top, dist, h], (vi + k) * 4);
        index.set([vi, vi + 1, vi + 2, vi, vi + 2, vi + 3], w * 6);
        w++;
        ring.push(new THREE.Vector2(ax, az));
      }
      (r === r0 ? contour : holes).push(...(r === r0 ? ring : [ring]));
    }

    // Roof cap (solid only) — flat, or a pyramid/spire up to the full height
    const base = roofV;
    if (roofShape > 0) {
      let cx = 0, cz = 0;
      for (const p of contour) { cx += p.x; cz += p.y; }
      cx /= contour.length; cz /= contour.length;
      for (const p of contour) { roofPos.push(p.x, top, p.y); roofInfo.push(minH, top, dist, h); }
      roofPos.push(cx, h, cz); roofInfo.push(minH, top, dist, h);
      const apex = base + contour.length;
      for (let i = 0; i < contour.length; i++) {
        roofIndex.push(base + i, base + ((i + 1) % contour.length), apex);
        edgePos.push(contour[i].x, top, contour[i].y, cx, h, cz);
        edgeInfo.push(minH, top, dist, h, minH, top, dist, h);
      }
      roofV += contour.length + 1;
    } else {
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const all = contour.concat(...holes);
      for (const p of all) { roofPos.push(p.x, top, p.y); roofInfo.push(minH, top, dist, h); }
      for (const t of tris) roofIndex.push(base + t[0], base + t[1], base + t[2]);
      roofV += all.length;
    }
  }

  const walls = new THREE.BufferGeometry();
  walls.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  walls.setAttribute("aWall", new THREE.BufferAttribute(wall, 3));
  walls.setAttribute("aInfo", new THREE.BufferAttribute(info, 4));
  walls.setIndex(new THREE.BufferAttribute(index, 1));

  const roofs = new THREE.BufferGeometry();
  roofs.setAttribute("position", new THREE.Float32BufferAttribute(roofPos, 3));
  roofs.setAttribute("aInfo", new THREE.Float32BufferAttribute(roofInfo, 4));
  roofs.setAttribute("aWall", new THREE.BufferAttribute(new Float32Array(roofPos.length), 3));
  roofs.setIndex(new THREE.Uint32BufferAttribute(roofIndex, 1));
  const edges = new THREE.BufferGeometry();
  edges.setAttribute("position", new THREE.Float32BufferAttribute(edgePos, 3));
  edges.setAttribute("aInfo", new THREE.Float32BufferAttribute(edgeInfo, 4));
  edges.setAttribute("aWall", new THREE.BufferAttribute(new Float32Array(edgePos.length), 3));
  return { walls, roofs, edges, count: nB };
}

function buildLines(buf) {
  const n = new Uint32Array(buf, 0, 1)[0];
  const pos = new Float32Array(buf, 4, n * 6);
  const cat8 = new Uint8Array(buf, 4 + n * 24, n);
  const cat = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) cat[i * 2] = cat[i * 2 + 1] = cat8[i];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aCat", new THREE.BufferAttribute(cat, 1));
  return g;
}

// Same projection as the data: meters, Times Square at the origin, avenues along -z
const LAT0 = 40.758, LON0 = -73.9855, GRID = (29 * Math.PI) / 180;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110540;
function project(lat, lon) {
  const e = (lon - LON0) * KX, n = (lat - LAT0) * KY;
  return [e * Math.cos(GRID) - n * Math.sin(GRID), -(e * Math.sin(GRID) + n * Math.cos(GRID))];
}

// Red aircraft-warning lights blinking slowly on top of the tallest towers
function buildBeacons(buf) {
  const [nB, nR] = new Uint32Array(buf, 0, 3);
  let o = 12;
  const meta = new Float32Array(buf, o, nB * 4); o += nB * 16;
  const ringStart = new Uint32Array(buf, o, nB + 1); o += (nB + 1) * 4;
  const vertStart = new Uint32Array(buf, o, nR + 1); o += (nR + 1) * 4;
  const verts = new Float32Array(buf, o);
  const pos = [], info = [];
  for (let b = 0; b < nB; b++) {
    const h = meta[b * 4];
    if (h < 160) continue;
    const v0 = vertStart[ringStart[b]], v1 = vertStart[ringStart[b] + 1];
    let cx = 0, cz = 0;
    for (let v = v0; v < v1; v++) { cx += verts[v * 2]; cz += verts[v * 2 + 1]; }
    cx /= v1 - v0; cz /= v1 - v0;
    pos.push(cx, h + 0.5, cz);
    info.push(Math.hypot(cx, cz), h, Math.random() * 6.28, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aInfo", new THREE.Float32BufferAttribute(info, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: shared,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${RISE_GLSL}
      attribute vec4 aInfo;
      varying float vA;
      void main() {
        float r = riseOf(aInfo.x);
        vec3 p = position;
        p.y -= (1.0 - r) * (aInfo.y + 2.0);
        float blink = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(uTime * 1.6 + aInfo.z));
        vA = blink * step(0.999, r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(2600.0 / -mv.z, 2.0, 5.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(1.0, 0.18, 0.12) * smoothstep(0.5, 0.0, d) * vA * 0.9, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

// The Statue of Liberty, in lines: pedestal, robe, head with the seven-ray crown,
// the raised torch and the tablet. Real proportions: 93 m from ground to torch.
function buildStatue() {
  const [x, z] = project(40.689247, -74.044502);
  const statue = new THREE.Group();
  const body = new THREE.Group();     // built facing +z, then turned to face south-east
  const parts = [];
  const add = (geo, px, py, pz, rot) => {
    const m = new THREE.Mesh(geo);
    m.position.set(px, py, pz);
    if (rot) m.quaternion.copy(rot);
    body.add(m);
    parts.push(m);
    return m;
  };
  const along = (from, to, radiusTop, radiusBottom, seg = 8) => {   // cylinder from -> to
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    return add(new THREE.CylinderGeometry(radiusTop, radiusBottom, dir.length(), seg, 4), mid.x, mid.y, mid.z, q);
  };

  const P = 47; // pedestal height
  add(new THREE.CylinderGeometry(9.5, 14, P, 4, 6).rotateY(Math.PI / 4), 0, P / 2, 0);
  const robe = [[6.0, 0], [6.4, 3], [5.9, 9], [5.3, 15], [4.9, 21], [4.6, 25], [4.3, 28], [2.4, 30], [1.6, 31.6]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(robe, 20), 0, P, 0);
  add(new THREE.SphereGeometry(2.4, 14, 10), 0, P + 33.6, 0.2);
  for (let i = 0; i < 7; i++) {                                           // crown rays
    const a = (-0.65 + (i / 6) * 1.3) * Math.PI / 2;
    const dir = new THREE.Vector3(Math.sin(a) * 0.75, 0.62, Math.cos(a) * 0.75).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const base = new THREE.Vector3(0, P + 34.6, 0.3).addScaledVector(dir, 2.4);
    add(new THREE.ConeGeometry(0.32, 3.4, 5), base.x, base.y, base.z, q);
  }
  along([-3.2, P + 28.2, 0], [-3.9, P + 40.5, -0.6], 0.85, 1.15);         // raised right arm
  along([-3.9, P + 40.5, -0.6], [-4.0, P + 43.4, -0.7], 0.75, 0.55);     // torch handle
  const tablet = add(new THREE.BoxGeometry(4.2, 7.2, 0.7, 2, 3, 1), 3.9, P + 21.5, 0.9);
  tablet.rotation.z = -0.28;
  along([3.0, P + 27.8, 0], [3.6, P + 23.5, 1.4], 0.8, 1.0);             // left arm to the tablet

  // flame (warm glow, not a line drawing)
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(1.3, 3.4, 12),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying float vY; void main() { vY = (modelMatrix * vec4(position, 1.0)).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vY; void main() { if (vY < 0.0) discard; gl_FragColor = vec4(1.0, 0.72, 0.3, 1.0) * 0.9; }`,
    })
  );
  flame.position.set(-4.05, P + 45.3, -0.7);
  body.add(flame);

  // line drawing + black body, both hidden below the floor while rising
  const vert = `varying float vY; void main() { vY = (modelMatrix * vec4(position, 1.0)).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const solid = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: `varying float vY; void main() { if (vY < 0.0) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }`,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const lineMat = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: vert,
    fragmentShader: `uniform vec3 uColor; uniform float uBright; varying float vY;
      void main() { if (vY < 0.0) discard; gl_FragColor = vec4(uColor * 0.8 * uBright, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  for (const m of parts) {
    m.material = solid;
    const lines = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), lineMat);
    m.add(lines);
  }

  // she faces south-east, toward the harbor entrance (grid is rotated 29° from true north)
  const facing = ((135 - 29) * Math.PI) / 180;
  body.rotation.y = Math.atan2(Math.sin(facing), -Math.cos(facing));
  statue.add(body);
  statue.position.set(x, 0, z);
  statue.userData = { dist: Math.hypot(x, z), height: 95 };
  return statue;
}

// Download a data file with progress, retrying if the connection drops.
// (Hosts send these compressed, so the size is often unknown: fall back to the expected size.)
async function fetchData(url, expectedBytes, onBytes) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onBytes(Math.min(got, expectedBytes * 0.99));
      }
      const out = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      onBytes(expectedBytes);
      return out.buffer;
    } catch (err) {
      if (attempt >= 3) throw err;
      onBytes(0);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

export async function loadCity(scene, { origin, unitsPerMeter, onProgress }) {
  const sizes = [5.05e6, 2.08e6];
  const got = [0, 0];
  const report = () => onProgress?.((got[0] + got[1]) / (sizes[0] + sizes[1]));
  const [bBuf, lBuf] = await Promise.all(
    ["data/buildings.bin", "data/lines.bin"].map((u, i) => fetchData(u, sizes[i], (b) => { got[i] = b; report(); }))
  );

  const { walls, roofs, edges, count } = buildBuildings(bBuf);
  const lines = buildLines(lBuf);

  const group = new THREE.Group();
  group.position.copy(origin);
  group.scale.setScalar(unitsPerMeter);
  group.visible = false;
  scene.add(group);

  const solid = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: WALL_VERT,
    fragmentShader: SOLID_FRAG,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const lineMat = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Wall quads are wound with their front faces inward, so the outside is the back side:
  // drawing one side only halves the work. Roofs are seen from above and below, so both.
  solid.side = THREE.BackSide;
  lineMat.side = THREE.BackSide;
  const roofSolid = solid.clone();
  roofSolid.uniforms = shared;
  roofSolid.side = THREE.DoubleSide;
  for (const mesh of [new THREE.Mesh(walls, solid), new THREE.Mesh(roofs, roofSolid), new THREE.Mesh(walls, lineMat)]) {
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const roofEdges = new THREE.LineSegments(edges, new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: WALL_VERT,
    fragmentShader: ROOF_LINE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  roofEdges.frustumCulled = false;
  group.add(roofEdges);

  const ground = new THREE.LineSegments(lines, new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  ground.frustumCulled = false;
  group.add(ground);

  group.add(buildBeacons(bBuf));
  const statue = buildStatue();
  group.add(statue);

  return {
    count,
    group,
    rise(t) {
      shared.uStart.value = t;
      group.visible = true;
    },
    update(t) {
      shared.uTime.value = t;
      // the statue rises with the same wave as the buildings
      const k = THREE.MathUtils.clamp((t - shared.uStart.value - statue.userData.dist / WAVE_SPEED) / RISE_SECONDS, 0, 1);
      statue.position.y = -statue.userData.height * (1 - (1 - Math.pow(1 - k, 3)));
    },
    setAds(texture) {
      shared.uAds.value = texture;
      shared.uHasAds.value = 1;
    },
  };
}
