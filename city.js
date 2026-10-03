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
  attribute vec2 aWall;   // distance along the wall (m), wall length (m)
  attribute vec4 aInfo;   // base height, wall top, distance from Times Square, building top
  varying vec2 vWall;
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
  varying vec2 vWall;
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

  void main() {
    if (vY < 0.0 || vRise <= 0.0) discard;   // still below the floor
    float u = vWall.x, L = vWall.y;
    float fu = fwidth(u), fh = fwidth(vH);
    float edges = max(
      lineAt(min(u, L - u), fu),
      max(lineAt(abs(vH - vInfo.y), fh), lineAt(abs(vH - vInfo.x), fh))
    );
    float inside = step(vInfo.x + 0.5, vH) * step(vH, vInfo.y - 0.5);
    float floors = repeatLine(vH - vInfo.x, 3.8) * inside;
    float windows = repeatLine(u, 1.9) * inside * step(1.0, u) * step(1.0, L - u);
    float seam = exp(-vY * 0.9) * (1.0 - vRise) * 2.0;    // glow where it cuts through the floor
    float i = (edges * 1.0 + floors * 0.34 + windows * 0.16) * vFade + seam;
    gl_FragColor = vec4(uColor * i * uBright, 1.0);
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
  const wall = new Float32Array(nWalls * 4 * 2);
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
        wall.set([0, L, L, L, L, L, 0, L], vi * 2);
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
  walls.setAttribute("aWall", new THREE.BufferAttribute(wall, 2));
  walls.setAttribute("aInfo", new THREE.BufferAttribute(info, 4));
  walls.setIndex(new THREE.BufferAttribute(index, 1));

  const roofs = new THREE.BufferGeometry();
  roofs.setAttribute("position", new THREE.Float32BufferAttribute(roofPos, 3));
  roofs.setAttribute("aInfo", new THREE.Float32BufferAttribute(roofInfo, 4));
  roofs.setAttribute("aWall", new THREE.BufferAttribute(new Float32Array((roofPos.length / 3) * 2), 2));
  roofs.setIndex(new THREE.Uint32BufferAttribute(roofIndex, 1));
  const edges = new THREE.BufferGeometry();
  edges.setAttribute("position", new THREE.Float32BufferAttribute(edgePos, 3));
  edges.setAttribute("aInfo", new THREE.Float32BufferAttribute(edgeInfo, 4));
  edges.setAttribute("aWall", new THREE.BufferAttribute(new Float32Array((edgePos.length / 3) * 2), 2));
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

export async function loadCity(scene, { origin, unitsPerMeter }) {
  const [bBuf, lBuf] = await Promise.all(
    ["data/buildings.bin", "data/lines.bin"].map((u) => fetch(u).then((r) => {
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.arrayBuffer();
    }))
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

  return {
    count,
    rise(t) {
      shared.uStart.value = t;
      group.visible = true;
    },
    update(t) {
      shared.uTime.value = t;
    },
  };
}
