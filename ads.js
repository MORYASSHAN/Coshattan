import * as THREE from "three";

// Billboard slides for the Times Square LED screens, drawn on one canvas (3 × 2 slides of 1024 × 512).
// The city shader samples a slide and shows it through an LED dot pattern.
const W = 1024, H = 512;
const FONT = '"Arial Black", "Arial Bold", Impact, sans-serif';
const RED = "#d7263d", GOLD = "#ffc23c", CYAN = "#7df9ff";

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

// A line of the story, set like a billboard
function slideStory(top, bottom, accent) {
  return (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#07090f"); g.addColorStop(1, "#000000");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    fitText(ctx, top, 900, 92);
    ctx.fillStyle = "#ffffff"; ctx.fillText(top, W / 2, 225);
    fitText(ctx, bottom, 900, 92);
    ctx.fillStyle = accent; ctx.fillText(bottom, W / 2, 345);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `700 22px ${FONT}`; ctx.fillText("— SHAAN", W / 2, 420);
  };
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
  canvas.width = W * 3;   // 3 × 2 slides
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  const slides = [
    slideIronMan,
    slideStory("EVERY PRODUCT IS A STORY.", "MOST FORGET TO TELL IT.", GOLD),
    slideIndustries,
    slideStory("PEOPLE FORGET FEATURES.", "THEY REMEMBER FEELINGS.", CYAN),
    slideDidIt,
    slideStory("LET SILENCE SPEAK.", "LET THEM BE THE HERO.", GOLD),
  ];
  slides.forEach((draw, i) => {
    ctx.save();
    ctx.translate((i % 3) * W, Math.floor(i / 3) * H);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    draw(ctx);
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.flipY = false;   // slide (0,0) = top-left, matching the shader's uv
  return tex;
}
