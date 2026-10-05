/*
  Full-screen title. The letters of the name fly in from off-screen and land in place,
  stretched to fill the whole page. "PRESENTS" then appears small and silver in front of it.
  It holds until the visitor scrolls; then the word zooms toward the screen and passes through,
  revealing the world behind it.
*/

const FONT = '"Anton", "Arial Narrow", Impact, sans-serif';
const D_PASS = 1.6;                        // seconds to zoom through the word
export const INTRO_REVEAL_AFTER = 0.3;     // seconds into the zoom when the world starts to show

const rand = (a, b) => a + Math.random() * (b - a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createIntro(word = "MORYASSHAN", sub = "PRESENTS") {
  const root = document.createElement("div");
  root.className = "big-title";
  const wordEl = document.createElement("div");
  wordEl.className = "big-word";
  const letters = [...word].map((ch) => {
    const s = document.createElement("span");
    s.textContent = ch;
    wordEl.appendChild(s);
    return s;
  });
  const subEl = document.createElement("div");
  subEl.className = "big-sub";
  subEl.textContent = sub;
  root.append(wordEl, subEl);
  document.body.appendChild(root);

  let fit = { sx: 1, sy: 1 };

  // Stretch the word so its letters fill the page edge to edge, top to bottom
  function layout() {
    const F = 200;
    wordEl.style.fontSize = `${F}px`;
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `400 ${F}px ${FONT}`;
    const m = ctx.measureText(word);
    const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const baseline = (F - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const glyphMid = baseline + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
    const width = wordEl.offsetWidth;
    fit = { sx: (window.innerWidth * 0.96) / width, sy: (window.innerHeight * 0.92) / glyphH };
    wordEl.style.left = `${(window.innerWidth - width) / 2}px`;
    wordEl.style.top = `${window.innerHeight / 2 - glyphMid}px`;
    wordEl.style.transformOrigin = `${width / 2}px ${glyphMid}px`;
    wordEl.style.transform = `scale(${fit.sx}, ${fit.sy})`;
  }
  const onResize = () => layout();

  return {
    // letters fly in and land; then "PRESENTS" appears. Resolves when the title is complete.
    async assemble() {
      try { await document.fonts.load(`400 100px Anton`); } catch { /* falls back to Impact */ }
      layout();
      window.addEventListener("resize", onResize);
      root.classList.add("on");
      const landed = letters.map((s, i) => {
        // start well off-screen (in the word's own, pre-stretch units)
        const dx = (rand(-1, 1) * window.innerWidth * 1.2) / fit.sx;
        const dy = (rand(-1, 1) * window.innerHeight * 1.2) / fit.sy;
        return s.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) rotate(${rand(-70, 70)}deg) scale(${rand(0.4, 1.8)})`, opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 1500, delay: 150 + i * 90, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" }
        ).finished;
      });
      await Promise.all(landed);
      await wait(300);
      // the big word steps back so the small silver "PRESENTS" reads clearly in front of it
      wordEl.animate([{ opacity: 1 }, { opacity: 0.35 }], { duration: 900, easing: "ease-out", fill: "forwards" });
      await subEl.animate(
        [
          { opacity: 0, letterSpacing: "1.4em", transform: "translate(-50%, -50%) scale(0.92)" },
          { opacity: 1, letterSpacing: "0.55em", transform: "translate(-50%, -50%) scale(1)" },
        ],
        { duration: 1300, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" }
      ).finished;
    },

    // the word zooms toward the screen and passes through it
    async passThrough() {
      window.removeEventListener("resize", onResize);
      const { sx, sy } = fit;
      subEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: "forwards" });
      wordEl.animate([{ opacity: 0.35 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
        { duration: D_PASS * 1000, fill: "forwards" });
      await wordEl.animate(
        [{ transform: `scale(${sx}, ${sy})` }, { transform: `scale(${sx * 28}, ${sy * 28})` }],
        { duration: D_PASS * 1000, easing: "cubic-bezier(0.6, 0, 0.9, 0.45)", fill: "forwards" }
      ).finished;
      root.remove();
    },
  };
}
