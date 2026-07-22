/**
 * Jan, the DeskBreak Coder page companion.
 * Original artwork by SwainWongStudio, distributed through codex-pets.net.
 * Jan sits on the footer divider and scrolls with the page.
 */
(function pageJanCompanion(global) {
  "use strict";

  if (!document.body || document.body.classList.contains("error-page")) return;

  const footer = document.querySelector("footer:not(.error-footer)");
  if (!footer) return;

  const perch = document.createElement("div");
  perch.className = "page-jan-perch";
  perch.setAttribute("aria-hidden", "true");
  footer.parentNode.insertBefore(perch, footer);

  const reducedMotion = global.matchMedia("(prefers-reduced-motion: reduce)");
  const states = {
    idle: { row: 0, frames: 6, frameMs: 310, loops: Infinity },
    wave: { row: 3, frames: 4, frameMs: 260, loops: 2 },
    failed: { row: 5, frames: 8, frameMs: 300, loops: 1 },
    waiting: { row: 6, frames: 6, frameMs: 360, loops: 1 },
    running: { row: 7, frames: 6, frameMs: 245, loops: 2 },
    review: { row: 8, frames: 6, frameMs: 330, loops: 1 },
  };
  const specialStates = ["wave", "failed", "waiting", "running", "review"];

  let animationFrame = 0;
  let stateName = "idle";
  let frameIndex = 0;
  let completedLoops = 0;
  let lastFrameAt = performance.now();
  let nextSpecialAt = lastFrameAt + randomBetween(12000, 22000);

  const root = document.createElement("div");
  root.className = "page-jan";
  root.dataset.state = "idle";
  root.setAttribute("aria-hidden", "true");

  const sprite = document.createElement("span");
  sprite.className = "page-jan-sprite";
  root.appendChild(sprite);
  perch.appendChild(root);

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function applyFrame() {
    const state = states[stateName];
    const x = (frameIndex / 7) * 100;
    const y = (state.row / 8) * 100;
    sprite.style.backgroundPosition = `${x}% ${y}%`;
    root.dataset.state = stateName;
  }

  function setState(name) {
    stateName = states[name] ? name : "idle";
    frameIndex = 0;
    completedLoops = 0;
    lastFrameAt = performance.now();
    applyFrame();
  }

  function chooseSpecialState() {
    const available = specialStates.filter((name) => name !== root.dataset.previousState);
    const name = available[Math.floor(Math.random() * available.length)] || "wave";
    root.dataset.previousState = name;
    setState(name);
  }

  function tick(time) {
    animationFrame = 0;
    if (document.hidden) return;

    if (reducedMotion.matches) {
      if (stateName !== "idle" || frameIndex !== 0) setState("idle");
      return;
    }

    const state = states[stateName];
    if (time - lastFrameAt >= state.frameMs) {
      const elapsedFrames = Math.max(1, Math.floor((time - lastFrameAt) / state.frameMs));
      lastFrameAt += elapsedFrames * state.frameMs;
      frameIndex += elapsedFrames;

      while (frameIndex >= state.frames) {
        frameIndex -= state.frames;
        completedLoops += 1;
      }

      if (stateName !== "idle" && completedLoops >= state.loops) {
        setState("idle");
        nextSpecialAt = time + randomBetween(12000, 22000);
      } else {
        applyFrame();
      }
    }

    if (stateName === "idle" && time >= nextSpecialAt) chooseSpecialState();
    animationFrame = global.requestAnimationFrame(tick);
  }

  function start() {
    root.classList.add("is-visible");
    if (reducedMotion.matches) {
      setState("idle");
      return;
    }
    if (!animationFrame) {
      lastFrameAt = performance.now();
      animationFrame = global.requestAnimationFrame(tick);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (animationFrame) global.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    } else {
      nextSpecialAt = performance.now() + randomBetween(8000, 16000);
      start();
    }
  });

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      if (animationFrame) global.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      setState("idle");
    } else {
      nextSpecialAt = performance.now() + randomBetween(8000, 16000);
      start();
    }
  });

  setState("idle");
  global.requestAnimationFrame(start);
})(window);
