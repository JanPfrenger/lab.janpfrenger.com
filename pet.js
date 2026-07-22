/**
 * DeskBreak Coder website companion
 * Original pet artwork by SwainWongStudio, distributed through codex-pets.net.
 * The companion stays fixed in one corner and only changes sprite animations.
 */
(function deskbreakCoderCompanion(global) {
  "use strict";

  if (!document.body) return;

  const storageKey = "jp-dot-enabled";
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

  let enabled = readPreference();
  let root = null;
  let sprite = null;
  let animationFrame = 0;
  let stateName = "idle";
  let frameIndex = 0;
  let completedLoops = 0;
  let lastFrameAt = performance.now();
  let nextSpecialAt = lastFrameAt + randomBetween(12000, 22000);

  function readPreference() {
    try {
      return global.localStorage.getItem(storageKey) !== "off";
    } catch (error) {
      return true;
    }
  }

  function writePreference(value) {
    try {
      global.localStorage.setItem(storageKey, value ? "on" : "off");
    } catch (error) {
      // Keep the in-memory preference when storage is unavailable.
    }
  }

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function applyFrame() {
    if (!sprite) return;
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
    if (!root || !enabled || document.hidden) return;

    if (reducedMotion.matches) {
      if (stateName !== "idle" || frameIndex !== 0) {
        stateName = "idle";
        frameIndex = 0;
        applyFrame();
      }
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
    if (!root || !enabled) return;
    root.dataset.disabled = "false";
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

  function stop() {
    if (animationFrame) global.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (root) {
      root.dataset.disabled = "true";
      root.classList.remove("is-visible");
    }
  }

  function updateToggle(button = document.querySelector(".dot-pet-toggle")) {
    if (!button) return;
    button.textContent = `pet: ${enabled ? "on" : "off"}`;
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Hide DeskBreak Coder" : "Show DeskBreak Coder");
    button.title = enabled ? "Hide DeskBreak Coder" : "Show DeskBreak Coder";
  }

  function createToggle() {
    const footer = document.querySelector("footer");
    if (!footer || footer.querySelector(".dot-pet-toggle")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dot-pet-toggle";
    button.addEventListener("click", () => {
      enabled = !enabled;
      writePreference(enabled);
      if (enabled) start();
      else stop();
      updateToggle(button);
    });
    footer.appendChild(button);
    updateToggle(button);
  }

  function mount() {
    root = document.createElement("div");
    root.className = "deskbreak-pet";
    root.dataset.disabled = String(!enabled);
    root.dataset.state = "idle";
    root.setAttribute("aria-hidden", "true");

    sprite = document.createElement("span");
    sprite.className = "deskbreak-pet-sprite";
    root.appendChild(sprite);
    document.body.appendChild(root);

    setState("idle");
    createToggle();
    if (enabled) global.requestAnimationFrame(() => start());
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (animationFrame) global.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    } else if (enabled) {
      nextSpecialAt = performance.now() + randomBetween(8000, 16000);
      start();
    }
  });

  reducedMotion.addEventListener("change", () => {
    if (!enabled) return;
    if (reducedMotion.matches) {
      if (animationFrame) global.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      setState("idle");
    } else {
      nextSpecialAt = performance.now() + randomBetween(8000, 16000);
      start();
    }
  });

  mount();
})(window);
