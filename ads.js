import * as THREE from "three";

// Billboard slides for the Times Square LED screens, drawn on one canvas (2 × 2 slides of 1024 × 512).
// The city shader samples a slide and shows it through an LED dot pattern.
const W = 1024, H = 512;
const FONT = '"Arial Black", "Arial Bold", Impact, sans-serif';
const RED = "#d7263d", GOLD = "#ffc23c", CYAN = "#7df9ff";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function arcReactor(ctx, x, y, r) {
  const glow = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 1.6);
  glow.addColorStop(0, "rgba(220,255,255,1)");
  glow.addColorStop(0.35, "rgba(125,249,255,0.9)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = r * 0.12;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 10; i++) {           // segmented outer ring
    const a = (i / 10) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(x, y, r * 1.25, a + 0.08, a + 0.5); ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
}

function fitText(ctx, text, maxWidth, size, weight = "900") {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 4; } while (ctx.measureText(text).width > maxWidth && s > 20);
}

function slideIronMan(ctx) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#3a0008"); g.addColorStop(0.6, "#120004"); g.addColorStop(1, "#2a1600");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  arcReactor(ctx, 190, H / 2, 95);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  fitText(ctx, "SHAAN", 640, 190);
  ctx.fillStyle = GOLD; ctx.fillText("SHAAN", 350, 250);
  fitText(ctx, "IS THE IRON MAN", 640, 72);
  ctx.fillStyle = RED; ctx.fillText("IS THE IRON MAN", 352, 345);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `700 26px ${FONT}`; ctx.fillText("GENIUS · BUILDER · DREAMER", 354, 400);
}

function slidePortrait(ctx, photo) {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  // photo on the left, cropped to a tall frame around the face
  const fw = 420, fh = H;
  const s = Math.max(fw / photo.width, fh / photo.height);
  const dw = photo.width * s, dh = photo.height * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(40, 0, fw, fh); ctx.clip();
  ctx.filter = "contrast(1.25) saturate(1.3) brightness(1.1)";
  ctx.drawImage(photo, 40 + (fw - dw) / 2, (fh - dh) / 2 - 10, dw, dh);
  ctx.restore();
  ctx.filter = "none";
  const fade = ctx.createLinearGradient(330, 0, 470, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = fade; ctx.fillRect(330, 0, 140, H);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `700 30px ${FONT}`; ctx.fillText("MEET THE", 500, 170);
  fitText(ctx, "IRON MAN", 500, 120);
  ctx.fillStyle = GOLD; ctx.fillText("IRON MAN", 498, 285);
  ctx.fillStyle = RED; ctx.fillRect(500, 315, 470, 8);
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 46px ${FONT}`; ctx.fillText("SHAAN", 500, 385);
}

function slideIndustries(ctx) {
  ctx.fillStyle = "#03060d"; ctx.fillRect(0, 0, W, H);
  // grid of light, like a tech keynote backdrop
  ctx.strokeStyle = "rgba(125,249,255,0.12)"; ctx.lineWidth = 2;
  for (let x = 0; x <= W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  arcReactor(ctx, W / 2, 150, 60);
  ctx.textAlign = "center";
  fitText(ctx, "SHAAN INDUSTRIES", 900, 104);
  ctx.fillStyle = "#ffffff"; ctx.fillText("SHAAN INDUSTRIES", W / 2, 330);
  ctx.fillStyle = CYAN;
  ctx.font = `700 34px ${FONT}`; ctx.fillText("BUILDING THE FUTURE", W / 2, 400);
}

function slideDidIt(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2b1b00"); g.addColorStop(1, "#000000");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = `700 40px ${FONT}`; ctx.fillText("SHAAN INDUSTRIES", W / 2, 150);
  fitText(ctx, "DID IT.", 900, 230);
  ctx.fillStyle = GOLD; ctx.fillText("DID IT.", W / 2, 360);
  ctx.fillStyle = RED; ctx.fillRect(W / 2 - 220, 395, 440, 10);
}

export async function makeAdsTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  const photo = await loadImage("textures/shaan.png");
  const slides = [slideIronMan, (c) => slidePortrait(c, photo), slideIndustries, slideDidIt];
  slides.forEach((draw, i) => {
    ctx.save();
    ctx.translate((i % 2) * W, Math.floor(i / 2) * H);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    draw(ctx);
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.flipY = false;   // slide (0,0) = top-left, matching the shader's uv
  return tex;
}
