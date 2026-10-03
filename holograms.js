import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

/*
  Models (in /models):
  - man.glb          Ready Player Me avatar (from the three.js examples)
  - supercar.glb     Ferrari 458 Italia (from the three.js examples)
  - classic-car.glb  "CarConcept" by Eric Chadwick, Darmstadt Graphics Group — CC BY 4.0
                     (Khronos glTF Sample Assets). Replace this file with any car .glb to swap it.
*/

const MAN_HEIGHT = 5;   // world units
const CAR_LENGTH = 12;  // world units

const HOLO_VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * objectNormal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const HOLO_FRAG = /* glsl */ `
  uniform vec3 uColorTop;
  uniform vec3 uColorBottom;
  uniform float uTime;
  uniform float uReveal;     // 0 → 1 fade in
  uniform float uSeam;       // bright line where the object cuts through the floor
  uniform float uBaseY;      // current bottom of the object (world y)
  uniform float uHeight;
  uniform float uStrength;
  uniform mat4 uModelInv;    // world → model space, so grid lines stick to the model
  uniform float uGrid;       // grid spacing in world units
  varying vec3 vNormalW;
  varying vec3 vWorldPos;

  // Evenly spaced hologram grid in model space (independent of mesh density)
  float modelGrid() {
    vec3 p = (uModelInv * vec4(vWorldPos, 1.0)).xyz / uGrid;
    vec3 n = abs(normalize(mat3(uModelInv) * vNormalW));
    vec3 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
    vec3 l = 1.0 - smoothstep(0.15, 0.9, g);
    vec3 w = 1.0 - smoothstep(0.55, 0.9, n);    // skip planes parallel to the surface
    return max(max(l.x * w.x, l.y * w.y), l.z * w.z);
  }

  void main() {
    float h = clamp((vWorldPos.y - uBaseY) / uHeight, 0.0, 1.0);
    vec3 color = mix(uColorBottom, uColorTop, smoothstep(0.05, 0.85, h));

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - abs(dot(normalize(vNormalW), viewDir)), 2.2);
    float scan = 0.9 + 0.1 * sin(vWorldPos.y * 14.0 - uTime * 2.0);

    #ifdef WIRE
      float i = uStrength * (0.5 + 0.5 * fres);
    #else
      float i = uStrength * (0.015 + 0.45 * fres);
      #ifdef GRID
        i += modelGrid() * 0.26 * (0.6 + 0.4 * fres);
      #endif
    #endif

    float seam = exp(-abs(vWorldPos.y) * 3.0) * uSeam;
    gl_FragColor = vec4(color * (i * scan + seam) * uReveal, 1.0);
  }
`;

// Invisible depth-only copy: hides the model's own back layers so the
// hologram shows its front surface instead of every layer adding up.
const depthOnly = new THREE.MeshBasicMaterial({
  colorWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

function makeHologram(root, { top, bottom, fill, wire, grid }) {
  const shared = {
    uColorTop: { value: new THREE.Color(top) },
    uColorBottom: { value: new THREE.Color(bottom) },
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uSeam: { value: 0 },
    uBaseY: { value: 0 },
    uHeight: { value: 1 },
    uModelInv: { value: new THREE.Matrix4() },
    uGrid: { value: grid || 1 },
  };
  const common = {
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  };
  const fillMat = new THREE.ShaderMaterial({
    ...common,
    defines: grid ? { GRID: "" } : {},
    uniforms: { ...shared, uStrength: { value: fill } },
  });
  const wireMat = new THREE.ShaderMaterial({
    ...common,
    wireframe: true,
    defines: { WIRE: "" },
    uniforms: { ...shared, uStrength: { value: wire } },
  });

  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  for (const mesh of meshes) {
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const isGlass = src.transparent || /glass|window|windshield/i.test(`${src.name} ${mesh.name}`);
    mesh.frustumCulled = false;
    if (!isGlass) {
      const d = mesh.clone();  // clones share geometry (and the skeleton for skinned meshes)
      d.material = depthOnly;
      mesh.parent.add(d);
    }
    if (wire > 0) {
      const w = mesh.clone();
      w.material = wireMat;
      mesh.parent.add(w);
    }
    mesh.material = fillMat;
  }
  return shared;
}

// Rotate a bone so the segment bone → child points in a world-space direction.
function aimBone(bone, child, dirWorld) {
  bone.updateWorldMatrix(true, true);
  const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(from, dirWorld.clone().normalize());
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(turn).multiply(boneQ));
}

// Center model on x/z, sit it on y = 0, make y-up and scale to a target size.
function normalize(model, { height, length }) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  // Some files are authored z-up: the smallest axis of a car should be its height.
  if (length && size.z < size.y && size.z < size.x) {
    model.rotation.x = -Math.PI / 2;
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    box.getSize(size);
  }
  const s = height ? height / size.y : length / Math.max(size.x, size.z);
  model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.z -= c.z;
  model.position.y -= box.min.y;
  return box.getSize(new THREE.Vector3()).y;
}

export async function loadHolograms(scene, onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / total);
  const draco = new DRACOLoader(manager).setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/");
  const loader = new GLTFLoader(manager).setDRACOLoader(draco);

  const [manGltf, superGltf, classicGltf] = await Promise.all([
    loader.loadAsync("models/man.glb"),
    loader.loadAsync("models/supercar.glb"),
    loader.loadAsync("models/classic-car.glb"),
  ]);

  const items = [];
  const add = (model, opts) => {
    const pivot = new THREE.Group();        // position + rise
    const spinner = new THREE.Group();      // turntable rotation
    pivot.position.set(opts.x, 0, opts.z);
    spinner.add(model);
    pivot.add(spinner);
    scene.add(pivot);
    const height = normalize(model, opts);
    const u = makeHologram(model, opts.look);
    u.uHeight.value = height;
    pivot.visible = false;
    items.push({ pivot, spinner, u, height, delay: opts.delay, spin: opts.spin || 0, angle: opts.angle || 0 });
  };

  // Man: relax the arms from the A-pose so they hang naturally at his sides
  // (only if the model has a standard humanoid skeleton; unrigged scans are left as they are)
  const man = manGltf.scene;
  const bone = (n) => man.getObjectByName(n);
  const arms = [
    ["LeftArm", "LeftForeArm", new THREE.Vector3(0.16, -1, 0.02)],
    ["RightArm", "RightForeArm", new THREE.Vector3(-0.16, -1, 0.02)],
    ["LeftForeArm", "LeftHand", new THREE.Vector3(0.1, -1, 0.12)],
    ["RightForeArm", "RightHand", new THREE.Vector3(-0.1, -1, 0.12)],
  ];
  for (const [a, b, dir] of arms) if (bone(a)?.isBone && bone(b)) aimBone(bone(a), bone(b), dir);

  add(man, {
    x: 0, z: -16, height: MAN_HEIGHT, delay: 0,
    look: { top: 0xe8f3ff, bottom: 0x9cc8ff, fill: 0.3, wire: 0.1 },
  });
  add(superGltf.scene, {
    x: -14, z: -18, length: CAR_LENGTH, delay: 0.35, spin: 0.18, angle: 0.6,
    look: { top: 0x6ff7ff, bottom: 0xd36bff, fill: 0.4, wire: 0, grid: 0.2 },
  });
  add(classicGltf.scene, {
    x: 14, z: -18, length: CAR_LENGTH, delay: 0.7, spin: -0.18, angle: -0.6,
    look: { top: 0x7cc9ff, bottom: 0x3a8dff, fill: 0.4, wire: 0.05 },
  });

  for (const it of items) it.spinner.rotation.y = it.angle;

  let startedAt = -1;
  return {
    start(t) {
      startedAt = t;
      items.forEach((it) => (it.pivot.visible = true));
    },
    update(dt, t) {
      for (const it of items) {
        it.u.uTime.value = t;
        if (startedAt < 0) continue;
        // Rise out of the floor
        const k = THREE.MathUtils.clamp((t - startedAt - it.delay) / 2.6, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        it.pivot.position.y = -it.height * 1.02 * (1 - e);
        it.u.uBaseY.value = it.pivot.position.y;
        it.u.uReveal.value = Math.min(1, k * 2.5);
        it.u.uSeam.value = Math.sin(Math.PI * Math.min(1, k * 1.1)) * 1.2;
        // Cars turn slowly; the man stays still
        it.spinner.rotation.y += it.spin * dt * e;
        it.spinner.updateMatrixWorld();
        it.u.uModelInv.value.copy(it.spinner.matrixWorld).invert();
      }
    },
  };
}
