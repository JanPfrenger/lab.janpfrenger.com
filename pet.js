/**
 * DotPet Canvas engine
 *
 * Built-in scenes: wave, hop, spin, peek, inspect, text-repair,
 * repair-404, panic, sleep, and celebrate.
 * Public entry points live on window.DotPet; create() also supports multiple pets.
 */
(function dotPetModule(global) {
  "use strict";

  const TAU = Math.PI * 2;
  const now = () => performance.now();
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, value) => clamp((value - a) / (b - a));
  const smoothstep = (t) => {
    const n = clamp(t);
    return n * n * (3 - 2 * n);
  };
  const easeInOutCubic = (t) => {
    const n = clamp(t);
    return n < 0.5 ? 4 * n * n * n : 1 - Math.pow(-2 * n + 2, 3) / 2;
  };
  const easeOutBack = (t, amount = 1.55) => {
    const n = clamp(t) - 1;
    return 1 + (amount + 1) * n * n * n + amount * n * n;
  };
  const damp = (current, target, speed, dt) => lerp(current, target, 1 - Math.exp(-speed * dt));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const randomBetween = (a, b) => a + Math.random() * (b - a);

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(Math.abs(width) / 2, Math.abs(height) / 2, radius);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function pebblePath(ctx, width, height) {
    const left = -width / 2;
    const right = width / 2;
    const top = -height / 2;
    const bottom = height / 2;
    ctx.beginPath();
    ctx.moveTo(left + width * 0.28, top);
    ctx.bezierCurveTo(left + width * 0.08, top + 1, left, top + height * 0.26, left, top + height * 0.54);
    ctx.bezierCurveTo(left, bottom - height * 0.15, left + width * 0.2, bottom, left + width * 0.48, bottom);
    ctx.bezierCurveTo(right - width * 0.16, bottom, right, bottom - height * 0.18, right, top + height * 0.47);
    ctx.bezierCurveTo(right, top + height * 0.15, right - width * 0.19, top, left + width * 0.28, top);
    ctx.closePath();
  }

  function cssColor(element, variable, fallback) {
    const value = getComputedStyle(element).getPropertyValue(variable).trim();
    return value || fallback;
  }

  class DotPetEngine {
    constructor(options = {}) {
      this.options = {
        context: "main",
        idleDelay: 5200,
        robotLifetime: 15000,
        scale: 1,
        followOffset: { x: 0, y: 0 },
        autoStart: true,
        autoEmerge: false,
        disableOnTouch: true,
        followPointerAfterExit: true,
        reducedMotion: "hide",
        edgePadding: 52,
        label: "Dot, a tiny animated site robot",
        ...options,
      };

      this.context = this.options.context;
      this.palette = {
        ink: "#11120f",
        paper: "#f0eee6",
        accent: "#d9ff62",
        steel: "#9da096",
        glass: "#22251f",
        shadow: "rgba(0, 0, 0, 0.2)",
      };

      this.root = null;
      this.canvas = null;
      this.ctx = null;
      this.hitbox = null;
      this.raf = 0;
      this.width = global.innerWidth || 1;
      this.height = global.innerHeight || 1;
      this.dpr = 1;
      this.running = false;
      this.frozen = false;
      this.debugVisible = false;
      this.disabled = false;
      this.hidden = false;
      this.reduced = false;
      this.touch = false;
      this.lastFrame = now();
      this.lastInput = now();
      this.pointer = {
        x: this.width * 0.64,
        y: this.height * 0.55,
        seen: false,
        speed: 0,
      };
      this.actor = {
        x: this.pointer.x,
        y: this.pointer.y,
        previousX: this.pointer.x,
        previousY: this.pointer.y,
        targetX: this.pointer.x,
        targetY: this.pointer.y,
        vx: 0,
        vy: 0,
        heading: 1,
        morph: 0,
        squash: 0,
        opacity: 0,
        wheel: 0,
        gazeX: 0,
        gazeY: 0,
        blink: 1,
      };

      this.mode = "dot";
      this.modeStarted = now();
      this.scene = null;
      this.pendingScene = null;
      this.robotExpiresAt = Infinity;
      this.nextBlinkAt = now() + randomBetween(1800, 4200);
      this.blinkStarted = -1;
      this.patrolTarget = null;
      this.nextPatrolAt = 0;
      this.autoEmerged = false;
      this.reactionStarted = -1;
      this.reactionStrength = 0;
      this.particles = [];
      this.bound = {};
      this.mediaReduced = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;
      this.mediaCoarse = global.matchMedia ? global.matchMedia("(pointer: coarse), (hover: none)") : null;

      if (this.options.autoStart) {
        if (document.body) this.mount();
        else document.addEventListener("DOMContentLoaded", () => this.mount(), { once: true });
      }
    }

    mount() {
      if (this.root || !document.body) return this;

      this.reduced = Boolean(this.mediaReduced && this.mediaReduced.matches);
      this.touch = Boolean(this.mediaCoarse && this.mediaCoarse.matches);
      this.computeDisabled();

      const root = document.createElement("div");
      root.className = "dot-pet-layer";
      root.dataset.reduced = this.options.reducedMotion;
      root.dataset.touch = this.options.disableOnTouch ? "disabled" : "enabled";
      root.dataset.disabled = String(this.disabled);
      root.setAttribute("aria-hidden", "true");

      const canvas = document.createElement("canvas");
      canvas.className = "dot-pet-canvas";
      root.appendChild(canvas);

      const hitbox = document.createElement("span");
      hitbox.className = "dot-pet-hitbox";
      hitbox.setAttribute("aria-hidden", "true");

      document.body.append(root, hitbox);
      this.root = root;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
      this.hitbox = hitbox;

      this.palette.ink = cssColor(root, "--dot-pet-ink", this.palette.ink);
      this.palette.paper = cssColor(root, "--dot-pet-paper", this.palette.paper);
      this.palette.accent = cssColor(root, "--dot-pet-accent", this.palette.accent);

      this.bound.resize = this.resize.bind(this);
      this.bound.pointerMove = this.onPointerMove.bind(this);
      this.bound.pointerDown = this.onPointerDown.bind(this);
      this.bound.visibility = this.onVisibilityChange.bind(this);
      this.bound.reducedChange = this.onReducedChange.bind(this);
      this.bound.coarseChange = this.onCoarseChange.bind(this);

      global.addEventListener("resize", this.bound.resize, { passive: true });
      global.addEventListener("pointermove", this.bound.pointerMove, { passive: true });
      global.addEventListener("pointerdown", this.bound.pointerDown, { passive: true });
      document.addEventListener("visibilitychange", this.bound.visibility);
      if (this.mediaReduced) this.mediaReduced.addEventListener("change", this.bound.reducedChange);
      if (this.mediaCoarse) this.mediaCoarse.addEventListener("change", this.bound.coarseChange);

      this.resize();
      if (!this.disabled) this.start();
      return this;
    }

    start() {
      if (this.running || this.disabled || !this.ctx) return this;
      this.running = true;
      this.lastFrame = now();
      this.raf = requestAnimationFrame((time) => this.frame(time));
      return this;
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return this;
    }

    freeze(value = true) {
      this.frozen = Boolean(value);
      return this;
    }

    resume() {
      this.frozen = false;
      this.lastFrame = now();
      if (!this.running && !this.disabled) this.start();
      return this;
    }

    setDebug(value = true) {
      this.debugVisible = Boolean(value);
      return this;
    }

    step(milliseconds = 16.667) {
      if (!this.ctx || this.disabled) return this;
      const dt = clamp(milliseconds / 1000, 0.001, 0.05);
      const time = this.lastFrame + milliseconds;
      this.lastFrame = time;
      this.update(time, dt);
      this.draw(time);
      return this;
    }

    getState() {
      return {
        mode: this.mode,
        context: this.context,
        scene: this.scene ? this.scene.name : null,
        x: this.actor.x,
        y: this.actor.y,
        morph: this.actor.morph,
        hidden: this.hidden,
        frozen: this.frozen,
        reducedMotion: this.reduced,
        touch: this.touch,
      };
    }

    destroy() {
      this.stop();
      global.removeEventListener("resize", this.bound.resize);
      global.removeEventListener("pointermove", this.bound.pointerMove);
      global.removeEventListener("pointerdown", this.bound.pointerDown);
      document.removeEventListener("visibilitychange", this.bound.visibility);
      if (this.mediaReduced) this.mediaReduced.removeEventListener("change", this.bound.reducedChange);
      if (this.mediaCoarse) this.mediaCoarse.removeEventListener("change", this.bound.coarseChange);
      if (this.root) this.root.remove();
      if (this.hitbox) this.hitbox.remove();
      this.root = null;
      this.canvas = null;
      this.ctx = null;
      this.hitbox = null;
      document.documentElement.classList.remove("dot-pet-detached", "dot-pet-active");
      return this;
    }

    resize() {
      if (!this.canvas || !this.ctx) return;
      this.width = Math.max(1, global.innerWidth);
      this.height = Math.max(1, global.innerHeight);
      this.dpr = Math.min(1.5, Math.max(1, global.devicePixelRatio || 1));
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.actor.x = clamp(this.actor.x, -60, this.width + 60);
      this.actor.y = clamp(this.actor.y, -60, this.height + 60);
    }

    onPointerMove(event) {
      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      this.pointer.speed = Math.hypot(dx, dy);
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.seen = true;
      this.lastInput = now();
      if (!this.running && !this.disabled) this.start();

      if (this.mode === "hidden" && this.options.followPointerAfterExit) this.summon({ as: "dot" });
    }

    onPointerDown(event) {
      if (this.mode === "dot" || this.mode === "hidden" || this.actor.morph < 0.58) return;
      if (Math.hypot(event.clientX - this.actor.x, event.clientY - this.actor.y) <= 40) this.poke();
    }

    onVisibilityChange() {
      if (document.hidden) this.stop();
      else if (!this.disabled) this.start();
    }

    onReducedChange(event) {
      this.reduced = event.matches;
      this.computeDisabled();
      if (this.root) this.root.dataset.disabled = String(this.disabled);
      if (this.disabled) {
        this.stop();
        this.clearCanvas();
      } else {
        this.start();
      }
    }

    onCoarseChange(event) {
      this.touch = event.matches;
      this.computeDisabled();
      if (this.root) this.root.dataset.disabled = String(this.disabled);
      if (this.disabled) {
        this.stop();
        this.clearCanvas();
      } else {
        this.start();
      }
    }

    computeDisabled() {
      this.disabled = (this.reduced && this.options.reducedMotion === "hide") ||
        (this.touch && this.options.disableOnTouch);
      return this.disabled;
    }

    clearCanvas() {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, this.width, this.height);
    }

    setContext(context) {
      this.context = context || "main";
      return this;
    }

    teleport(x, y) {
      if (Number.isFinite(x)) this.actor.x = this.actor.targetX = x;
      if (Number.isFinite(y)) this.actor.y = this.actor.targetY = y;
      this.actor.previousX = this.actor.x;
      this.actor.previousY = this.actor.y;
      return this;
    }

    setPalette(palette = {}) {
      Object.assign(this.palette, palette);
      return this;
    }

    setScene(name, options = {}) {
      return this.play(name, options);
    }

    play(name, options = {}) {
      if (this.disabled || !name) return this;
      if (!this.running) this.start();
      const scene = { name, options, requestedAt: now() };
      if (this.mode === "dot" || this.mode === "folding" || this.mode === "hidden") {
        this.pendingScene = scene;
        this.emerge();
      } else if (this.mode === "emerging") {
        this.pendingScene = scene;
      } else {
        this.beginScene(scene);
      }
      return this;
    }

    emerge() {
      if (this.disabled) return this;
      if (this.mode === "robot" || this.mode === "emerging") return this;
      if (this.mode === "hidden") {
        this.actor.opacity = 1;
        this.hidden = false;
        if (this.root) this.root.dataset.hidden = "false";
      }
      this.mode = "emerging";
      this.modeStarted = now();
      this.emergeBaseX = this.actor.x;
      this.emergeBaseY = this.actor.y;
      this.actor.morph = Math.max(0, this.actor.morph);
      this.autoEmerged = true;
      this.emit("emerge", { context: this.context });
      return this;
    }

    fold() {
      if (this.mode === "dot" || this.mode === "folding" || this.mode === "hidden") return this;
      this.scene = null;
      this.mode = "folding";
      this.modeStarted = now();
      return this;
    }

    summon(options = {}) {
      if (!this.running && !this.disabled) this.start();
      this.hidden = false;
      this.actor.opacity = 1;
      if (this.root) this.root.dataset.hidden = "false";
      if (options.as === "robot") {
        this.mode = "robot";
        this.actor.morph = 1;
        this.modeStarted = now();
        this.robotExpiresAt = now() + this.options.robotLifetime;
      } else {
        this.mode = "dot";
        this.actor.morph = 0;
        this.modeStarted = now();
        document.documentElement.classList.remove("dot-pet-detached");
      }
      return this;
    }

    dismiss(options = {}) {
      this.scene = null;
      this.pendingScene = null;
      if (options.immediate) {
        this.mode = "hidden";
        this.hidden = true;
        this.actor.opacity = 0;
        if (this.root) this.root.dataset.hidden = "true";
        document.documentElement.classList.remove("dot-pet-detached");
      } else {
        this.mode = "exiting";
        this.modeStarted = now();
      }
      return this;
    }

    toggle() {
      if (this.hidden || this.mode === "hidden") this.summon({ as: "dot" });
      else this.dismiss();
      return this;
    }

    poke() {
      if (this.disabled) return this;
      const time = now();
      this.reactionStarted = time;
      this.reactionStrength = Math.min(1.5, this.reactionStrength + 0.65);
      this.robotExpiresAt = time + this.options.robotLifetime;

      if (this.mode === "dot") {
        this.pendingScene = { name: "wave", options: { short: true }, requestedAt: time };
        this.emerge();
      } else if (this.mode === "robot" && !this.scene) {
        const choices = ["wave", "hop", "spin"];
        this.beginScene({
          name: choices[Math.floor(Math.random() * choices.length)],
          options: { short: true },
          requestedAt: time,
        });
      } else if (this.scene && this.scene.name === "sleep") {
        this.beginScene({ name: "panic", options: { short: true }, requestedAt: time });
      }

      this.burst(this.actor.x, this.actor.y - 18, this.palette.accent, 7, 1);
      this.emit("poke", { context: this.context, mode: this.mode });
      return this;
    }

    repairText(target, options = {}) {
      return this.play("text-repair", { target, glyph: "o", ...options });
    }

    beginScene(scene) {
      const duration = this.sceneDuration(scene.name, scene.options);
      this.scene = {
        ...scene,
        startedAt: now(),
        duration,
        placed: false,
        phase: -1,
        fromX: this.actor.x,
        fromY: this.actor.y,
      };
      this.mode = "robot";
      this.actor.morph = 1;
      this.robotExpiresAt = now() + duration + this.options.robotLifetime;
      if (scene.options.detachCursor !== false) document.documentElement.classList.add("dot-pet-detached");
      this.emit("scenestart", { name: scene.name, options: scene.options });
      return this;
    }

    sceneDuration(name, options = {}) {
      const short = options.short ? 0.72 : 1;
      const durations = {
        wave: 2500,
        "home-intro": 5100,
        hop: 1500,
        spin: 1700,
        peek: 5200,
        inspect: 5500,
        desk: 8200,
        "text-repair": 6750,
        "repair-404": 7600,
        panic: 3000,
        sleep: 9000,
        celebrate: 3000,
      };
      return (durations[name] || 3200) * short;
    }

    defaultSceneForContext() {
      if (this.context === "apps") return { name: "wave", options: { short: true } };
      if (this.context === "lab") return { name: "inspect", options: { ambient: true } };
      if (this.context === "404") return { name: "repair-404", options: { target: "[data-pet-404]" } };
      return { name: "wave", options: {} };
    }

    frame(time) {
      if (!this.running) return;
      const dt = Math.min(0.034, Math.max(0.001, (time - this.lastFrame) / 1000));
      this.lastFrame = time;
      if (!this.frozen) this.update(time, dt);
      this.draw(time);
      const dormant = this.mode === "hidden" ||
        (this.mode === "dot" && !this.pointer.seen && this.actor.opacity <= 0.001);
      if (dormant && !this.scene && !this.pendingScene && this.particles.length === 0) {
        this.running = false;
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame((nextTime) => this.frame(nextTime));
    }

    update(time, dt) {
      const actor = this.actor;
      actor.previousX = actor.x;
      actor.previousY = actor.y;

      this.updateBlink(time);
      this.updateReaction(time);

      if (this.mode === "dot") this.updateDot(time, dt);
      else if (this.mode === "emerging") this.updateEmerging(time, dt);
      else if (this.mode === "robot") this.updateRobot(time, dt);
      else if (this.mode === "folding") this.updateFolding(time, dt);
      else if (this.mode === "exiting") this.updateExit(time, dt);

      actor.vx = (actor.x - actor.previousX) / dt;
      actor.vy = (actor.y - actor.previousY) / dt;
      this.pointer.speed = damp(this.pointer.speed, 0, 9, dt);
      if (Math.abs(actor.vx) > 6 && this.mode !== "dot") actor.heading = actor.vx > 0 ? 1 : -1;
      actor.wheel += Math.abs(actor.vx) * dt * 0.035;

      const gazeTargetX = clamp((this.pointer.x - actor.x) / 90, -1, 1);
      const gazeTargetY = clamp((this.pointer.y - actor.y) / 90, -1, 1);
      actor.gazeX = damp(actor.gazeX, gazeTargetX, 8, dt);
      actor.gazeY = damp(actor.gazeY, gazeTargetY, 8, dt);

      this.updateParticles(dt);
      this.positionHitbox();
    }

    updateDot(time, dt) {
      const actor = this.actor;
      const offset = this.options.followOffset;
      const targetX = this.pointer.x + offset.x;
      const targetY = this.pointer.y + offset.y;
      actor.x = damp(actor.x, targetX, 25, dt);
      actor.y = damp(actor.y, targetY, 25, dt);
      actor.morph = damp(actor.morph, 0, 18, dt);
      actor.opacity = damp(actor.opacity, this.pointer.seen ? 1 : 0, 14, dt);
      actor.squash = damp(actor.squash, clamp(this.pointer.speed / 140, 0, 0.28), 12, dt);

      if (this.options.autoEmerge && this.pointer.seen && !this.autoEmerged &&
          time - this.lastInput > this.options.idleDelay) {
        this.pendingScene = this.defaultSceneForContext();
        this.emerge();
      }
    }

    updateEmerging(time, dt) {
      const actor = this.actor;
      const elapsed = time - this.modeStarted;
      const t = clamp(elapsed / 1500);
      const anticipation = Math.sin(invLerp(0, 0.18, t) * Math.PI);
      const unfold = easeOutBack(invLerp(0.14, 0.78, t), 1.25);
      const settle = Math.sin(invLerp(0.64, 1, t) * Math.PI * 2) * (1 - invLerp(0.64, 1, t));

      actor.morph = clamp(unfold, 0, 1.08);
      actor.squash = anticipation * 0.48 + settle * 0.1;
      actor.x = this.emergeBaseX;
      actor.y = this.emergeBaseY - Math.sin(invLerp(0.18, 0.78, t) * Math.PI) * 11;

      if (t > 0.2 && t < 0.8 && Math.random() < dt * 10) {
        this.burst(actor.x, actor.y, this.palette.accent, 1, 0.48);
      }

      if (t >= 1) {
        actor.morph = 1;
        actor.squash = 0;
        this.mode = "robot";
        this.modeStarted = time;
        this.robotExpiresAt = time + this.options.robotLifetime;
        const pending = this.pendingScene;
        this.pendingScene = null;
        if (pending) this.beginScene(pending);
      }
    }

    updateRobot(time, dt) {
      this.actor.morph = damp(this.actor.morph, 1, 18, dt);
      this.actor.opacity = damp(this.actor.opacity, 1, 12, dt);
      this.actor.squash = damp(this.actor.squash, 0, 10, dt);

      if (this.scene) this.updateScene(time, dt);
      else this.updatePatrol(time, dt);

      if (!this.scene && time > this.robotExpiresAt) this.fold();
    }

    updateFolding(time, dt) {
      const actor = this.actor;
      const t = clamp((time - this.modeStarted) / 1050);
      const collapseT = clamp(t / 0.58);
      const collapse = 1 - easeInOutCubic(collapseT);
      const travelT = invLerp(0.52, 1, t);
      actor.morph = collapse;
      actor.squash = Math.sin(collapseT * Math.PI) * -0.35;
      if (travelT > 0) {
        actor.x = damp(actor.x, this.pointer.x + this.options.followOffset.x, 9 + travelT * 16, dt);
        actor.y = damp(actor.y, this.pointer.y + this.options.followOffset.y, 9 + travelT * 16, dt);
      }
      if (t >= 1) {
        this.mode = "dot";
        this.modeStarted = time;
        actor.morph = 0;
        actor.squash = 0;
        this.autoEmerged = false;
        this.lastInput = time;
        document.documentElement.classList.remove("dot-pet-detached");
        this.emit("fold", { context: this.context });
      }
    }

    updateExit(time, dt) {
      const actor = this.actor;
      const t = clamp((time - this.modeStarted) / 1150);
      const side = actor.x < this.width / 2 ? -1 : 1;
      actor.x = damp(actor.x, side < 0 ? -100 : this.width + 100, 7 + t * 8, dt);
      actor.squash = Math.sin(t * Math.PI) * 0.2;
      actor.opacity = 1 - smoothstep(invLerp(0.68, 1, t));
      if (t >= 1) {
        this.mode = "hidden";
        this.hidden = true;
        actor.opacity = 0;
        if (this.root) this.root.dataset.hidden = "true";
        document.documentElement.classList.remove("dot-pet-detached");
        this.emit("dismiss", { context: this.context });
      }
    }

    updatePatrol(time, dt) {
      const actor = this.actor;
      if (!this.patrolTarget || time > this.nextPatrolAt || distance(actor, this.patrolTarget) < 16) {
        this.patrolTarget = this.chooseEdgePoint();
        this.nextPatrolAt = time + randomBetween(4500, 8200);
      }
      actor.x = damp(actor.x, this.patrolTarget.x, 1.45, dt);
      actor.y = damp(actor.y, this.patrolTarget.y, 1.45, dt);
    }

    chooseEdgePoint() {
      const pad = this.options.edgePadding;
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) return { x: pad, y: randomBetween(90, this.height - 90) };
      if (edge === 1) return { x: this.width - pad, y: randomBetween(90, this.height - 90) };
      if (edge === 2) return { x: randomBetween(90, this.width - 90), y: Math.min(this.height - pad, this.height - 42) };
      return { x: randomBetween(90, this.width - 90), y: Math.max(pad, 54) };
    }

    resolveTarget(target, fallback = null) {
      let value = target;
      if (typeof value === "string") value = document.querySelector(value);
      if (value && typeof value.getBoundingClientRect === "function") {
        const rect = value.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          rect,
          element: value,
        };
      }
      if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
        return { x: value.x, y: value.y, width: value.width || 0, height: value.height || 0, rect: value };
      }
      return fallback || { x: this.width * 0.65, y: this.height * 0.58, width: 0, height: 0 };
    }

    updateScene(time, dt) {
      const scene = this.scene;
      const actor = this.actor;
      const elapsed = time - scene.startedAt;
      const t = clamp(elapsed / scene.duration);
      const target = this.resolveTarget(scene.options.target);

      switch (scene.name) {
        case "home-intro": {
          const side = scene.options.side || (scene.fromX < this.width / 2 ? "left" : "right");
          const edgeX = side === "left" ? 54 : this.width - 54;
          const edgeY = clamp(scene.options.y || scene.fromY, 128, this.height - 82);

          if (t < 0.34) {
            const move = easeOutBack(invLerp(0, 0.34, t), 0.7);
            actor.x = lerp(scene.fromX, edgeX, move);
            actor.y = lerp(scene.fromY, edgeY, move) - Math.abs(Math.sin(t * Math.PI * 4)) * 18;
            actor.squash = Math.sin(t * Math.PI * 8) * 0.1;
          } else if (t < 0.67) {
            actor.x = damp(actor.x, edgeX, 12, dt);
            actor.y = damp(actor.y, edgeY, 12, dt);
            actor.heading = side === "left" ? 1 : -1;
          } else {
            const goodbye = invLerp(0.67, 1, t);
            actor.x = damp(actor.x, edgeX, 12, dt);
            actor.y = damp(actor.y, edgeY - Math.sin(goodbye * Math.PI * 3) * 3, 12, dt);
            actor.squash = Math.sin(goodbye * Math.PI * 6) * 0.05;
          }
          break;
        }
        case "wave": {
          actor.x = damp(actor.x, clamp(actor.x, 55, this.width - 55), 8, dt);
          actor.y = damp(actor.y, clamp(actor.y, 55, this.height - 55), 8, dt);
          break;
        }
        case "hop": {
          actor.squash = Math.sin(t * Math.PI * 4) * 0.18;
          break;
        }
        case "spin": {
          actor.squash = Math.sin(t * Math.PI * 2) * 0.1;
          break;
        }
        case "peek": {
          const side = scene.options.side === "left" || scene.options.side === "right"
            ? scene.options.side
            : (actor.x < this.width / 2 ? "left" : "right");
          const edgeX = side === "left" ? 19 : this.width - 19;
          const desiredY = clamp(scene.options.y || this.height * 0.46, 70, this.height - 70);
          actor.x = damp(actor.x, edgeX, t < 0.82 ? 3.2 : 8, dt);
          actor.y = damp(actor.y, desiredY, 4, dt);
          actor.heading = side === "left" ? 1 : -1;
          if (t > 0.84) actor.x = damp(actor.x, side === "left" ? -90 : this.width + 90, 8, dt);
          break;
        }
        case "inspect": {
          const position = scene.options.position;
          const side = target.x > this.width / 2 ? -1 : 1;
          const desiredX = Number.isFinite(position?.x)
            ? clamp(position.x, 24, this.width - 24)
            : clamp(target.x + side * Math.max(58, target.width * 0.4), 52, this.width - 52);
          const desiredY = Number.isFinite(position?.y)
            ? clamp(position.y, 58, this.height - 54)
            : clamp(target.y + Math.max(36, target.height * 0.2), 58, this.height - 54);
          actor.x = damp(actor.x, desiredX, t < 0.34 ? 2.4 : 5.5, dt);
          actor.y = damp(actor.y, desiredY, t < 0.34 ? 2.4 : 5.5, dt);
          actor.heading = target.x > actor.x ? 1 : -1;
          break;
        }
        case "desk": {
          const deskX = clamp(target.x, 62, this.width - 62);
          const deskY = clamp(target.y, 76, this.height - 42);
          if (t < 0.14) {
            const enter = easeOutBack(invLerp(0, 0.14, t), 0.75);
            actor.x = lerp(scene.fromX, deskX, enter);
            actor.y = lerp(scene.fromY, deskY, enter) - Math.sin(enter * Math.PI) * 18;
          } else if (t < 0.88) {
            actor.x = damp(actor.x, deskX, 10, dt);
            actor.y = damp(actor.y, deskY, 10, dt);
            actor.squash = Math.sin(time * 0.004) * 0.018;
          } else {
            const leave = easeInOutCubic(invLerp(0.88, 1, t));
            actor.x = deskX;
            actor.y = lerp(deskY, this.height + 78, leave);
          }
          break;
        }
        case "text-repair": {
          const dropX = clamp(scene.options.dropX || target.x + 72, 58, this.width - 58);
          const dropY = clamp(scene.options.dropY || target.y + target.height + 74, 82, this.height - 64);
          const approachX = clamp(dropX + 62, 60, this.width - 58);
          const setX = clamp(target.x - 38, 54, this.width - 54);
          const setY = clamp(target.y + target.height * 0.7 + 34, 64, this.height - 58);

          if (t < 0.22) {
            const move = easeOutBack(invLerp(0, 0.22, t), 0.55);
            actor.x = lerp(scene.fromX, approachX, move);
            actor.y = lerp(scene.fromY, dropY, move) - Math.sin(move * Math.PI) * 24;
          } else if (t < 0.63) {
            const push = easeInOutCubic(invLerp(0.22, 0.63, t));
            actor.x = lerp(approachX, setX, push);
            actor.y = lerp(dropY, setY, push) + Math.sin(push * Math.PI * 10) * 2;
            actor.heading = -1;
            actor.squash = 0.12 + Math.sin(push * Math.PI * 10) * 0.08;
          } else if (t < 0.79) {
            const lift = invLerp(0.63, 0.79, t);
            actor.x = lerp(setX, target.x + 26, easeOutBack(lift, 0.45));
            actor.y = setY - Math.sin(lift * Math.PI) * 42;
            actor.squash = Math.sin(lift * Math.PI * 2) * 0.14;
          } else if (t < 0.91) {
            actor.x = damp(actor.x, target.x + 42, 8, dt);
            actor.y = damp(actor.y, target.y + target.height + 32, 8, dt);
            actor.heading = -1;
          } else {
            actor.x = damp(actor.x, this.width + 96, 7.5, dt);
            actor.y = damp(actor.y, target.y + target.height + 44, 6, dt);
            actor.heading = 1;
          }

          if (t > 0.69 && !scene.placed) {
            scene.placed = true;
            this.burst(target.x, target.y, this.palette.accent, 14, 1.35);
            if (typeof scene.options.onPlace === "function") scene.options.onPlace(target.element || target);
            this.emit("place", { name: scene.name, target: target.element || target, glyph: scene.options.glyph || "o" });
          }
          break;
        }
        case "repair-404": {
          const side = target.x > this.width / 2 ? -1 : 1;
          const workX = clamp(target.x + side * Math.min(88, Math.max(54, target.width * 0.24)), 56, this.width - 56);
          const workY = clamp(target.y + Math.min(52, target.height * 0.24), 62, this.height - 58);
          if (t < 0.2) {
            const enter = easeOutBack(invLerp(0, 0.2, t), 0.8);
            actor.x = lerp(scene.fromX, workX, enter);
            actor.y = lerp(scene.fromY, workY, enter) - Math.sin(enter * Math.PI) * 22;
          } else if (t < 0.68) {
            actor.x = damp(actor.x, workX, 8, dt);
            actor.y = damp(actor.y, workY, 8, dt);
            actor.heading = target.x > actor.x ? 1 : -1;
            actor.squash = Math.sin(t * Math.PI * 12) * 0.07;
          } else {
            const panic = easeInOutCubic(invLerp(0.68, 1, t));
            const panicX = side < 0 ? 42 : this.width - 42;
            actor.x = lerp(workX, panicX, panic);
            actor.y = workY + Math.sin(panic * Math.PI * 12) * 7;
            actor.squash = Math.sin(panic * Math.PI * 18) * 0.1;
          }
          if (t > 0.26 && t < 0.68 && Math.random() < dt * 17) {
            this.burst(target.x + randomBetween(-24, 24), target.y + randomBetween(-16, 16), this.palette.accent, 1, 0.75);
          }
          break;
        }
        case "panic": {
          const escapeX = actor.x < this.width / 2 ? this.width - 55 : 55;
          actor.x = damp(actor.x, escapeX, 3.6, dt);
          actor.y += Math.sin(t * Math.PI * 18) * dt * 34;
          actor.squash = Math.sin(t * Math.PI * 16) * 0.09;
          break;
        }
        case "sleep": {
          actor.y = damp(actor.y, this.height - Math.max(48, this.options.edgePadding), 3, dt);
          break;
        }
        case "celebrate": {
          actor.squash = Math.sin(t * Math.PI * 8) * 0.12;
          if (Math.random() < dt * 8) this.burst(actor.x, actor.y - 28, this.palette.accent, 1, 0.8);
          break;
        }
        default:
          break;
      }

      if (t >= 1) this.endScene();
    }

    endScene() {
      if (!this.scene) return;
      const completed = this.scene;
      this.scene = null;
      this.emit("sceneend", { name: completed.name, options: completed.options });
      if (completed.options.loop) {
        this.beginScene({ name: completed.name, options: completed.options, requestedAt: now() });
      } else if (completed.options.after === "fold" || completed.name === "home-intro") {
        this.fold();
      } else if (completed.options.after === "hide" || (completed.name === "peek" && completed.options.hideAfter !== false)) {
        document.documentElement.classList.remove("dot-pet-detached");
        if (this.options.followPointerAfterExit && this.pointer.seen) {
          this.mode = "dot";
          this.hidden = false;
          this.actor.morph = 0;
          this.actor.opacity = 1;
          this.teleport(this.pointer.x, this.pointer.y);
          if (this.root) this.root.dataset.hidden = "false";
        } else {
          this.mode = "hidden";
          this.hidden = true;
          this.actor.opacity = 0;
          if (this.root) this.root.dataset.hidden = "true";
        }
      } else {
        document.documentElement.classList.remove("dot-pet-detached");
      }
    }

    updateBlink(time) {
      if (this.blinkStarted > 0) {
        const t = (time - this.blinkStarted) / 170;
        this.actor.blink = 1 - Math.sin(clamp(t) * Math.PI) * 0.96;
        if (t >= 1) {
          this.actor.blink = 1;
          this.blinkStarted = -1;
          this.nextBlinkAt = time + randomBetween(1900, 4800);
        }
      } else if (time > this.nextBlinkAt) {
        this.blinkStarted = time;
      }
    }

    updateReaction(time) {
      if (this.reactionStarted < 0) return;
      const t = clamp((time - this.reactionStarted) / 620);
      this.reactionStrength *= 0.97;
      if (t >= 1) {
        this.reactionStarted = -1;
        this.reactionStrength = 0;
      }
    }

    updateParticles(dt) {
      for (let index = this.particles.length - 1; index >= 0; index -= 1) {
        const particle = this.particles[index];
        particle.life -= dt;
        if (particle.life <= 0) {
          this.particles.splice(index, 1);
          continue;
        }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 45 * dt;
        particle.vx *= Math.pow(0.975, dt * 60);
      }
    }

    burst(x, y, color, count = 8, strength = 1) {
      for (let index = 0; index < count; index += 1) {
        const angle = randomBetween(0, TAU);
        const speed = randomBetween(24, 84) * strength;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 18,
          size: randomBetween(1.5, 3.8),
          life: randomBetween(0.34, 0.78),
          maxLife: 0.78,
          color,
        });
      }
    }

    positionHitbox() {
      // Interaction is handled by document-level pointer distance checks.
      // Keeping the hidden hitbox inert avoids layout or style writes per frame.
    }

    draw(time) {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      if (this.actor.opacity <= 0.001) return;

      this.drawActionLines(ctx, time);
      this.drawParticles(ctx);

      const actor = this.actor;
      const baseScale = this.options.scale;
      const reactionT = this.reactionStarted > 0 ? clamp((time - this.reactionStarted) / 620) : 1;
      const clickHop = this.reactionStarted > 0 ? Math.sin(reactionT * Math.PI) * 9 * this.reactionStrength : 0;
      const clickSquash = this.reactionStarted > 0 ? Math.sin(reactionT * Math.PI * 2) * 0.12 * this.reactionStrength : 0;
      const sceneSpin = this.scene && this.scene.name === "spin"
        ? easeInOutCubic(clamp((time - this.scene.startedAt) / this.scene.duration)) * TAU * 2
        : 0;
      const bob = actor.morph > 0.5 && !(this.scene && this.scene.name === "sleep")
        ? Math.sin(time * 0.004 + actor.x * 0.01) * 1.5
        : 0;
      const movingSquash = clamp(Math.abs(actor.vx) / 900, 0, 0.12);

      ctx.save();
      ctx.globalAlpha = actor.opacity;
      ctx.translate(actor.x, actor.y - clickHop + bob);
      ctx.rotate(sceneSpin);
      ctx.scale(
        actor.heading * baseScale * (1 + actor.squash * 0.22 + movingSquash),
        baseScale * (1 - actor.squash * 0.28 - clickSquash),
      );
      this.drawActor(ctx, time);
      ctx.restore();
      if (this.debugVisible) this.drawDebug(ctx);
    }

    drawActionLines(ctx, time) {
      const actor = this.actor;
      const sceneT = this.scene ? clamp((time - this.scene.startedAt) / this.scene.duration) : 0;
      const fast = this.scene && (
        this.scene.name === "panic" ||
        this.scene.name === "spin" ||
        (this.scene.name === "text-repair" && sceneT > 0.22 && sceneT < 0.64) ||
        (this.scene.name === "repair-404" && sceneT > 0.68)
      );
      if (!fast) return;
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = this.palette.accent;
      ctx.lineWidth = 1.4;
      for (let index = 0; index < 5; index += 1) {
        const offset = (index - 2) * 9 + Math.sin(time * 0.01 + index) * 2;
        ctx.beginPath();
        ctx.moveTo(actor.x - actor.heading * 34, actor.y + offset);
        ctx.lineTo(actor.x - actor.heading * (58 + index * 7), actor.y + offset);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawParticles(ctx) {
      ctx.save();
      for (const particle of this.particles) {
        ctx.globalAlpha = clamp(particle.life / particle.maxLife);
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    drawActor(ctx, time) {
      const morph = clamp(this.actor.morph);
      if (morph < 0.985) this.drawDot(ctx, time, 1 - smoothstep(invLerp(0.16, 0.9, morph)));
      if (morph > 0.05) this.drawRobot(ctx, time, smoothstep(invLerp(0.04, 0.88, morph)));
      if (this.mode === "emerging") this.drawTransformationRings(ctx, time);
    }

    drawDot(ctx, time, alpha) {
      if (alpha <= 0) return;
      const speedStretch = clamp(this.pointer.speed / 180, 0, 0.28);
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.rotate(Math.atan2(this.actor.vy, this.actor.vx || 0.01));
      ctx.scale(1 + speedStretch, 1 - speedStretch * 0.42);
      ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
      ctx.shadowBlur = 7;
      ctx.fillStyle = this.palette.steel;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha *= 0.42;
      ctx.fillStyle = this.palette.paper;
      ctx.beginPath();
      ctx.arc(-3.5, -4, 3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    drawTransformationRings(ctx, time) {
      const t = clamp((time - this.modeStarted) / 1500);
      ctx.save();
      ctx.strokeStyle = this.palette.accent;
      ctx.lineWidth = 1.5;
      for (let index = 0; index < 3; index += 1) {
        const local = (t * 1.7 - index * 0.22 + 1) % 1;
        ctx.globalAlpha = (1 - local) * 0.45;
        ctx.beginPath();
        ctx.arc(0, 0, 16 + local * 42, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawRobot(ctx, time, alpha) {
      const scene = this.scene;
      const sceneT = scene ? clamp((time - scene.startedAt) / scene.duration) : 0;
      const bodyWidth = 52;
      const bodyHeight = 47;
      const sleeping = scene && scene.name === "sleep";
      const panic = scene && (scene.name === "panic" || (scene.name === "repair-404" && sceneT > 0.7));
      const carrying = scene && scene.name === "text-repair" && sceneT > 0.2 && sceneT < 0.69 && !scene.placed;
      const repairing = scene && scene.name === "repair-404" && sceneT > 0.24 && sceneT < 0.72;
      const inspecting = scene && scene.name === "inspect";
      const desk = scene && scene.name === "desk";
      const waving = scene && (
        scene.name === "wave" ||
        scene.name === "peek" ||
        (scene.name === "home-intro" && sceneT > 0.34 && sceneT < 0.67)
      );
      const celebrating = scene && scene.name === "celebrate";

      ctx.save();
      ctx.globalAlpha *= alpha;

      ctx.save();
      ctx.globalAlpha *= 0.2;
      ctx.fillStyle = this.palette.ink;
      ctx.beginPath();
      ctx.ellipse(0, 28, 31, 7, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      this.drawLegs(ctx, time, bodyWidth, bodyHeight);
      this.drawArm(ctx, -1, time, sceneT, { waving, carrying, repairing, inspecting, celebrating, desk });
      this.drawArm(ctx, 1, time, sceneT, { waving, carrying, repairing, inspecting, celebrating, desk });

      ctx.save();
      const bodyLean = panic ? Math.sin(time * 0.04) * 0.05 : 0;
      ctx.rotate(bodyLean);
      pebblePath(ctx, bodyWidth, bodyHeight);
      ctx.fillStyle = this.palette.paper;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.palette.ink;
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha *= 0.28;
      ctx.strokeStyle = this.palette.steel;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(-4, 1, 20, -1.55, 1.35);
      ctx.stroke();
      ctx.restore();

      roundedRect(ctx, -19, -14, 38, 24, 9);
      ctx.fillStyle = this.palette.glass;
      ctx.fill();

      ctx.fillStyle = this.palette.accent;
      roundedRect(ctx, -18, 15, 24, 4, 2);
      ctx.fill();
      ctx.fillStyle = this.palette.ink;
      ctx.globalAlpha *= 0.42;
      roundedRect(ctx, 9, 15, 9, 4, 2);
      ctx.fill();
      ctx.globalAlpha /= 0.42;

      ctx.strokeStyle = this.palette.ink;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -bodyHeight / 2);
      ctx.lineTo(3, -32);
      ctx.stroke();
      ctx.fillStyle = this.palette.accent;
      ctx.beginPath();
      ctx.arc(4, -35, 3.2, 0, TAU);
      ctx.fill();

      this.drawEye(ctx, time, { sleeping, panic, inspecting, repairing, celebrating, desk });
      ctx.restore();

      if (carrying && scene.options.renderGlyph !== false) this.drawHeldGlyph(ctx, scene.options.glyph || "o", sceneT);
      if (repairing) this.drawRepairTool(ctx, time);
      if (sleeping) this.drawSleepMarks(ctx, time);
      if (inspecting) this.drawScanner(ctx, time, sceneT);
      if (desk) this.drawLaptop(ctx, time, sceneT);
      if (panic) this.drawPanicMark(ctx, time);
      ctx.restore();
    }

    drawLegs(ctx, time, bodyWidth, bodyHeight) {
      const hipY = bodyHeight / 2 - 2;
      const stride = clamp(Math.abs(this.actor.vx) / 260, 0, 1);
      for (const side of [-1, 1]) {
        const step = Math.sin(time * 0.018 + side * Math.PI / 2) * 3.5 * stride;
        const legX = side * 13;
        ctx.save();
        ctx.strokeStyle = this.palette.ink;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(legX, hipY);
        ctx.lineTo(legX - 3, hipY + 5);
        ctx.lineTo(legX + 3, hipY + 10);
        ctx.lineTo(legX + step, hipY + 16);
        ctx.stroke();
        ctx.fillStyle = this.palette.paper;
        ctx.strokeStyle = this.palette.ink;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(legX + step + side * 2, hipY + 18, 8, 3.7, side * 0.08, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = this.palette.accent;
        ctx.beginPath();
        ctx.arc(legX, hipY + 1, 2.3, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    drawArm(ctx, side, time, sceneT, flags) {
      const shoulder = { x: side * 27, y: -2 };
      let elbow = { x: side * 38, y: 7 };
      let hand = { x: side * 42, y: 18 };

      if (flags.waving && side === 1) {
        const wave = Math.sin(time * 0.015) * 7;
        elbow = { x: 35, y: -17 };
        hand = { x: 37 + wave, y: -34 };
      } else if (flags.carrying) {
        elbow = { x: side * 32, y: 14 };
        hand = { x: side * 12, y: 27 };
      } else if (flags.repairing) {
        const tap = Math.sin(time * 0.036) * 8;
        elbow = { x: side * 36, y: 2 };
        hand = { x: side * (43 + tap), y: -8 + tap * 0.35 };
      } else if (flags.inspecting) {
        elbow = { x: side * 34, y: 10 };
        hand = { x: side * 29, y: 24 };
      } else if (flags.desk) {
        const type = Math.sin(time * 0.026 + side * 1.7) * 2.4;
        elbow = { x: side * 30, y: 8 };
        hand = { x: side * 16, y: 27 + type };
      } else if (flags.celebrating) {
        elbow = { x: side * 37, y: -14 };
        hand = { x: side * (39 + Math.sin(time * 0.02 + side) * 4), y: -30 };
      }

      ctx.save();
      ctx.strokeStyle = this.palette.ink;
      ctx.lineWidth = 4.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.lineTo(hand.x, hand.y);
      ctx.stroke();
      ctx.fillStyle = this.palette.paper;
      ctx.strokeStyle = this.palette.ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(elbow.x, elbow.y, 4.1, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 4.4, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    drawEye(ctx, time, expression) {
      const blink = expression.sleeping ? 0.08 : this.actor.blink;
      const eyeWidth = expression.panic ? 10 : 9;
      const eyeHeight = Math.max(0.8, (expression.panic ? 8.6 : 6.8) * blink);
      const gazeX = this.actor.gazeX * 3;
      const gazeY = expression.desk ? 2.8 : this.actor.gazeY * 2;
      ctx.save();
      ctx.translate(0, -3);
      ctx.fillStyle = this.palette.accent;
      ctx.beginPath();
      ctx.ellipse(0, 0, eyeWidth, eyeHeight, expression.inspecting ? -0.08 : 0, 0, TAU);
      ctx.fill();
      if (blink > 0.2) {
        ctx.fillStyle = this.palette.ink;
        ctx.beginPath();
        ctx.arc(gazeX, gazeY, expression.panic ? 3 : 2.6, 0, TAU);
        ctx.fill();
        ctx.fillStyle = this.palette.paper;
        ctx.globalAlpha *= 0.8;
        ctx.beginPath();
        ctx.arc(gazeX - 0.9, gazeY - 0.9, 0.8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      if (expression.celebrating) {
        ctx.strokeStyle = this.palette.accent;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 5, 4, 0.15, Math.PI - 0.15);
        ctx.stroke();
      }
    }

    drawPanicMark(ctx, time) {
      const flicker = Math.sin(time * 0.04) > 0 ? 1 : 0.55;
      ctx.save();
      ctx.globalAlpha *= flicker;
      ctx.strokeStyle = this.palette.accent;
      ctx.fillStyle = this.palette.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-30, -29);
      ctx.lineTo(-36, -39);
      ctx.moveTo(-23, -34);
      ctx.lineTo(-24, -46);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-39, -43, 2, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    drawLaptop(ctx, time, sceneT) {
      const screenGlow = 0.55 + Math.sin(time * 0.005) * 0.12;
      ctx.save();
      ctx.translate(0, 31);
      ctx.fillStyle = this.palette.ink;
      ctx.strokeStyle = this.palette.paper;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-24, -19);
      ctx.lineTo(24, -19);
      ctx.lineTo(20, 8);
      ctx.lineTo(-20, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha *= screenGlow;
      ctx.fillStyle = this.palette.accent;
      roundedRect(ctx, -14, -11, 28, 2.5, 1.25);
      ctx.fill();
      roundedRect(ctx, -14, -5, 18 + Math.sin(time * 0.003) * 4, 2.5, 1.25);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = this.palette.paper;
      ctx.strokeStyle = this.palette.ink;
      ctx.beginPath();
      ctx.moveTo(-27, 8);
      ctx.lineTo(27, 8);
      ctx.lineTo(22, 13);
      ctx.lineTo(-22, 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = this.palette.accent;
      ctx.beginPath();
      ctx.arc(0, -1, 2.2 + Math.sin(sceneT * Math.PI * 8) * 0.3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    drawHeldGlyph(ctx, glyph, sceneT) {
      const bounce = Math.sin(sceneT * Math.PI * 7) * 1.4;
      ctx.save();
      ctx.translate(0, 30 + bounce);
      ctx.scale(this.actor.heading, 1);
      ctx.font = "700 32px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = this.palette.ink;
      ctx.strokeText(glyph, 0, 0);
      ctx.fillStyle = this.palette.accent;
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    }

    drawRepairTool(ctx, time) {
      ctx.save();
      ctx.translate(41, -10);
      ctx.rotate(Math.sin(time * 0.036) * 0.5);
      ctx.strokeStyle = this.palette.paper;
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(13, -12);
      ctx.stroke();
      ctx.strokeStyle = this.palette.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(15, -14, 5, 0.4, Math.PI * 1.6);
      ctx.stroke();
      ctx.restore();
    }

    drawSleepMarks(ctx, time) {
      ctx.save();
      ctx.fillStyle = this.palette.steel;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let index = 0; index < 3; index += 1) {
        const drift = ((time * 0.025 + index * 17) % 48);
        ctx.globalAlpha = 1 - drift / 48;
        ctx.font = `${10 + index * 2}px ui-monospace, monospace`;
        ctx.fillText("z", 29 + index * 7, -23 - drift);
      }
      ctx.restore();
    }

    drawScanner(ctx, time, sceneT) {
      const scan = (time * 0.00055) % 1;
      ctx.save();
      ctx.globalAlpha = 0.18 + Math.sin(sceneT * Math.PI) * 0.18;
      ctx.fillStyle = this.palette.accent;
      ctx.beginPath();
      ctx.moveTo(24, 2);
      ctx.lineTo(70, -8 + scan * 28);
      ctx.lineTo(70, 11 + scan * 28);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawDebug(ctx) {
      const actor = this.actor;
      ctx.save();
      ctx.strokeStyle = "rgba(217, 255, 98, 0.8)";
      ctx.fillStyle = "rgba(17, 18, 15, 0.88)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(actor.x, actor.y, 41, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(actor.x - 7, actor.y);
      ctx.lineTo(actor.x + 7, actor.y);
      ctx.moveTo(actor.x, actor.y - 7);
      ctx.lineTo(actor.x, actor.y + 7);
      ctx.stroke();
      const label = `${this.mode}${this.scene ? ` / ${this.scene.name}` : ""}`;
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      const width = ctx.measureText(label).width + 12;
      roundedRect(ctx, actor.x - width / 2, actor.y + 49, width, 21, 5);
      ctx.fill();
      ctx.fillStyle = this.palette.accent;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, actor.x, actor.y + 59.5);
      if (this.scene && this.scene.options.target) {
        const target = this.resolveTarget(this.scene.options.target);
        ctx.strokeStyle = "rgba(255, 102, 68, 0.9)";
        ctx.beginPath();
        ctx.arc(target.x, target.y, 10, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    emit(name, detail = {}) {
      const event = new CustomEvent(`dotpet:${name}`, { detail: { engine: this, ...detail } });
      global.dispatchEvent(event);
      if (this.root) this.root.dispatchEvent(new CustomEvent(`dotpet:${name}`, { detail }));
    }
  }

  let defaultEngine = null;

  const DotPet = {
    Engine: DotPetEngine,
    create(options = {}) {
      return new DotPetEngine(options);
    },
    init(options = {}) {
      if (defaultEngine) defaultEngine.destroy();
      defaultEngine = new DotPetEngine(options);
      return defaultEngine;
    },
    get instance() {
      return defaultEngine;
    },
    play(name, options) {
      if (defaultEngine) defaultEngine.play(name, options);
      return defaultEngine;
    },
    setScene(name, options) {
      return this.play(name, options);
    },
    setContext(context) {
      if (defaultEngine) defaultEngine.setContext(context);
      return defaultEngine;
    },
    repairText(target, options) {
      if (defaultEngine) defaultEngine.repairText(target, options);
      return defaultEngine;
    },
    summon(options) {
      if (defaultEngine) defaultEngine.summon(options);
      return defaultEngine;
    },
    dismiss(options) {
      if (defaultEngine) defaultEngine.dismiss(options);
      return defaultEngine;
    },
    toggle() {
      if (defaultEngine) defaultEngine.toggle();
      return defaultEngine;
    },
    freeze(value = true) {
      if (defaultEngine) defaultEngine.freeze(value);
      return defaultEngine;
    },
    resume() {
      if (defaultEngine) defaultEngine.resume();
      return defaultEngine;
    },
    debug(value = true) {
      if (defaultEngine) defaultEngine.setDebug(value);
      return defaultEngine;
    },
    step(milliseconds) {
      if (defaultEngine) defaultEngine.step(milliseconds);
      return defaultEngine;
    },
    state() {
      return defaultEngine ? defaultEngine.getState() : null;
    },
    destroy() {
      if (defaultEngine) defaultEngine.destroy();
      defaultEngine = null;
    },
  };

  global.DotPet = DotPet;
})(window);

(function dotPetDirector(global) {
  "use strict";

  if (!document.body || !global.DotPet) return;

  const body = document.body;
  const html = document.documentElement;
  const site = body.dataset.site || "main";
  const route = body.dataset.scene || "interior";
  const finePointer = global.matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = global.matchMedia("(prefers-reduced-motion: reduce)");
  const params = new URLSearchParams(global.location.search);
  const debugScene = params.get("dotDebug");
  const requestedSpeed = Number(params.get("dotSpeed"));
  const speed = Number.isFinite(requestedSpeed) ? Math.min(3, Math.max(0.15, requestedSpeed)) : 1;
  const storageKey = "jp-dot-enabled";

  let engine = null;
  let enabled = readPreference();
  let activeName = null;
  let activeCleanup = null;
  let primaryPlayed = false;
  let peekCount = 0;
  let peekScheduled = false;
  let lastScrollAt = -Infinity;
  let lastResizeAt = -Infinity;
  let themeObserver = null;
  const timers = new Set();

  function readPreference() {
    try {
      return localStorage.getItem(storageKey) !== "off";
    } catch (error) {
      return true;
    }
  }

  function writePreference(value) {
    try {
      localStorage.setItem(storageKey, value ? "on" : "off");
    } catch (error) {
      // Private browsing can disable storage. The in-memory preference still works.
    }
  }

  function later(callback, delay) {
    const id = global.setTimeout(() => {
      timers.delete(id);
      callback();
    }, Math.max(0, delay));
    timers.add(id);
    return id;
  }

  function forgetTimer(id) {
    if (!id) return;
    global.clearTimeout(id);
    timers.delete(id);
  }

  function clearTimers() {
    timers.forEach((id) => global.clearTimeout(id));
    timers.clear();
  }

  function cssValue(element, property, fallback) {
    const value = global.getComputedStyle(element).getPropertyValue(property).trim();
    return value || fallback;
  }

  function refreshPalette() {
    if (!engine) return;
    const errorCanvas = document.getElementById("errorCanvas");
    const source = errorCanvas || html;
    engine.setPalette({
      ink: cssValue(source, errorCanvas ? "--error-fg" : "--text", "#11120f"),
      paper: cssValue(source, errorCanvas ? "--error-bg" : "--bg", "#f0eee6"),
      accent: cssValue(source, errorCanvas ? "--error-accent" : "--accent", "#d9ff62"),
      steel: cssValue(source, errorCanvas ? "--error-muted" : "--text-2", "#9da096"),
      glass: cssValue(source, errorCanvas ? "--error-button-fg" : "--surface", "#22251f"),
    });
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
      if (enabled && !reducedMotion.matches) startDirector();
      else stopDirector();
      updateToggle(button);
    });
    footer.appendChild(button);
    updateToggle(button);
  }

  function updateToggle(button = document.querySelector(".dot-pet-toggle")) {
    if (!button) return;
    const running = enabled && !reducedMotion.matches;
    button.textContent = `dot: ${running ? "on" : "off"}`;
    button.setAttribute("aria-pressed", String(running));
    button.setAttribute("aria-label", running ? "Pause playful Dot animations" : "Enable playful Dot animations");
    button.title = running ? "Pause playful animations" : "Enable playful animations";
  }

  function isBusy() {
    const time = performance.now();
    const focused = document.activeElement && document.activeElement !== body &&
      document.activeElement !== html && document.activeElement.matches("a, button, input, textarea, select, [contenteditable]");
    return document.hidden || focused || time - lastScrollAt < 950 || time - lastResizeAt < 1100 || Boolean(activeName);
  }

  function visibleEnough(element, padding = 20) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > padding && rect.right > padding &&
      rect.top < global.innerHeight - padding && rect.left < global.innerWidth - padding;
  }

  function resetToCursor() {
    if (!engine) return;
    engine.scene = null;
    engine.pendingScene = null;
    document.documentElement.classList.remove("dot-pet-detached");
    if (finePointer.matches && engine.pointer.seen) {
      engine.teleport(engine.pointer.x, engine.pointer.y).summon({ as: "dot" });
      engine.actor.opacity = 1;
    } else {
      engine.dismiss({ immediate: true });
    }
  }

  function cancelCurrent(options = {}) {
    const scheduleAmbient = options.scheduleAmbient !== false;
    if (activeCleanup) {
      const cleanup = activeCleanup;
      activeCleanup = null;
      cleanup();
    }
    activeName = null;
    resetToCursor();
    if (scheduleAmbient && primaryPlayed && engine && !peekScheduled) schedulePeek(false);
  }

  function primeDot(x, y) {
    if (!engine) return;
    engine.dismiss({ immediate: true });
    engine.teleport(x, y).summon({ as: "dot" });
    engine.actor.opacity = 1;
  }

  function primeRobot(x, y) {
    if (!engine) return;
    engine.dismiss({ immediate: true });
    engine.teleport(x, y).summon({ as: "robot" });
    engine.actor.opacity = 1;
  }

  function safePeekPoint(side) {
    const minY = Math.min(global.innerHeight - 80, Math.max(92, (document.querySelector("header")?.getBoundingClientRect().bottom || 0) + 52));
    const footerRect = document.querySelector("footer")?.getBoundingClientRect();
    const maxY = Math.max(minY, Math.min(global.innerHeight - 72, footerRect && footerRect.top > 0 ? footerRect.top - 60 : global.innerHeight - 72));
    const blockers = Array.from(document.querySelectorAll(
      "a, button, h1, h2, h3, .eyebrow, .hero-lead, .directory-lead, .project-card, .error-message, .portrait-wrap"
    ));

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const y = minY + Math.random() * Math.max(1, maxY - minY);
      const x = side === "left" ? 26 : global.innerWidth - 26;
      const blocked = blockers.some((element) => {
        const rect = element.getBoundingClientRect();
        return x > rect.left - 58 && x < rect.right + 58 && y > rect.top - 64 && y < rect.bottom + 64;
      });
      if (!blocked) return y;
    }

    return null;
  }

  function playPeek(options = {}) {
    if (!engine || isBusy() || peekCount >= 3) return false;
    const side = options.side || (Math.random() > 0.5 ? "right" : "left");
    const y = safePeekPoint(side);
    if (!Number.isFinite(y)) return false;
    activeName = "peek";
    peekCount += 1;
    primeRobot(side === "left" ? -52 : global.innerWidth + 52, y);
    engine.play("peek", { side, y, short: true, hideAfter: true, after: "hide" });
    return true;
  }

  function playDesk() {
    if (!engine || isBusy() || peekCount >= 3 || !finePointer.matches || route === "404") return false;
    const footer = document.querySelector("footer");
    const footerRect = footer?.getBoundingClientRect();
    const y = Math.max(100, Math.min(global.innerHeight - 54, footerRect && footerRect.top > 120 ? footerRect.top - 56 : global.innerHeight - 54));
    const blockers = Array.from(document.querySelectorAll(
      "a, button, h1, h2, h3, .eyebrow, .hero-lead, .directory-lead, .project-card, .error-message, .portrait-wrap"
    ));
    const candidates = Math.random() > 0.5 ? [global.innerWidth - 78, 78] : [78, global.innerWidth - 78];
    const x = candidates.find((candidate) => !blockers.some((element) => {
      const rect = element.getBoundingClientRect();
      return candidate + 60 > rect.left && candidate - 60 < rect.right && y + 44 > rect.top && y - 74 < rect.bottom;
    }));
    if (!Number.isFinite(x)) return false;

    activeName = "desk";
    peekCount += 1;
    primeRobot(x, global.innerHeight + 72);
    engine.play("desk", { target: { x, y }, after: "hide" });
    return true;
  }

  function schedulePeek(initial = false) {
    if (!engine || peekScheduled || peekCount >= 3) return;
    peekScheduled = true;
    const delay = debugScene === "peek" ? 650 : (initial ? randomMs(25000, 40000) : randomMs(55000, 85000));
    later(() => {
      peekScheduled = false;
      const deskTurn = debugScene !== "peek" && Math.random() < 0.34;
      const played = deskTurn ? (playDesk() || playPeek()) : playPeek();
      if (!played) schedulePeek(false);
    }, delay);
  }

  function randomMs(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function playMainIntro(attempt = 0) {
    if (!engine || primaryPlayed || route !== "home") return;
    if (!finePointer.matches) {
      primaryPlayed = true;
      playPeek({ side: "right" });
      return;
    }
    const ready = finePointer.matches && engine.pointer.seen && performance.now() - engine.lastInput > 3000 && !isBusy();
    if (!ready) {
      if (attempt < 24) later(() => playMainIntro(attempt + 1), 750);
      else schedulePeek(true);
      return;
    }

    primaryPlayed = true;
    activeName = "home-intro";
    const hasRightPortrait = visibleEnough(document.querySelector(".portrait-wrap"), 0);
    engine.play("home-intro", {
      side: hasRightPortrait ? "left" : (engine.pointer.x < global.innerWidth / 2 ? "left" : "right"),
      y: Math.max(132, Math.min(global.innerHeight - 86, engine.pointer.y)),
      after: "fold",
    });
  }

  function makeLetterClone(letter, rect) {
    const computed = global.getComputedStyle(letter);
    const clone = document.createElement("span");
    clone.className = "dot-pet-letter-clone";
    clone.setAttribute("aria-hidden", "true");
    clone.textContent = letter.textContent || "o";
    Object.assign(clone.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      color: computed.color,
      font: computed.font,
      fontKerning: computed.fontKerning,
      fontFeatureSettings: computed.fontFeatureSettings,
      letterSpacing: computed.letterSpacing,
      lineHeight: computed.lineHeight,
      textAlign: computed.textAlign,
    });
    body.appendChild(clone);
    return clone;
  }

  function playAppsRepair(attempt = 0) {
    if (!engine || primaryPlayed || site !== "apps" || route !== "directory") return;
    const letter = document.querySelector('[data-pet-letter="jobs-o"]');
    const tail = document.querySelector("[data-pet-jobs-tail]");
    if (!letter || !tail) return;
    const rect = letter.getBoundingClientRect();

    if (isBusy() || !visibleEnough(letter, 54)) {
      if (attempt < 28) later(() => playAppsRepair(attempt + 1), 900);
      return;
    }

    primaryPlayed = true;
    if (global.innerWidth < 820 || !finePointer.matches) {
      playAppsNudge(letter, rect);
      return;
    }

    activeName = "apps-repair";
    const duration = 6750 * speed;
    const clone = makeLetterClone(letter, rect);
    const dropX = Math.min(global.innerWidth - 112, rect.left + Math.max(58, rect.width * 1.2));
    const dropY = Math.min(global.innerHeight - 92, rect.bottom + Math.max(70, rect.height * 0.92));
    const dx = dropX - rect.left;
    const dy = dropY - rect.top;
    const tailRect = tail.getBoundingClientRect();
    const tailShift = Math.max(tailRect.left - rect.left + 1, 12);
    const normalLetterColor = global.getComputedStyle(letter).color;
    const accentLetterColor = cssValue(html, "--accent", "#d9ff62");
    let cleaned = false;
    let placementAnimation = null;

    letter.style.opacity = "0";
    body.classList.add("dot-pet-scene-running");

    const letterAnimation = clone.animate([
      { offset: 0, transform: "translate3d(0,0,0) rotate(0deg)", color: normalLetterColor, opacity: 1 },
      { offset: 0.045, transform: "translate3d(-2px,0,0) rotate(-4deg)" },
      { offset: 0.08, transform: "translate3d(2px,-2px,0) rotate(4deg)" },
      { offset: 0.115, transform: "translate3d(0,-6px,0) rotate(0deg)" },
      { offset: 0.19, transform: `translate3d(${dx}px,${dy}px,0) rotate(82deg)`, color: accentLetterColor },
      { offset: 0.235, transform: `translate3d(${dx}px,${dy - 16}px,0) rotate(96deg)` },
      { offset: 0.285, transform: `translate3d(${dx}px,${dy}px,0) rotate(110deg)` },
      { offset: 0.42, transform: `translate3d(${dx * 0.72}px,${dy * 0.88}px,0) rotate(205deg)` },
      { offset: 0.61, transform: `translate3d(${dx * 0.2}px,${Math.max(28, dy * 0.42)}px,0) rotate(326deg)` },
      { offset: 0.695, transform: "translate3d(0,-5px,0) rotate(360deg)", color: accentLetterColor },
      { offset: 0.735, transform: "translate3d(0,3px,0) rotate(360deg)" },
      { offset: 0.78, transform: "translate3d(0,0,0) rotate(360deg)", color: normalLetterColor, opacity: 0 },
      { offset: 1, transform: "translate3d(0,0,0) rotate(360deg)", opacity: 0 },
    ], { duration, easing: "linear", fill: "forwards" });

    const tailAnimation = tail.animate([
      { offset: 0, transform: "translateX(0)" },
      { offset: 0.18, transform: "translateX(0)" },
      { offset: 0.24, transform: `translateX(-${tailShift}px)` },
      { offset: 0.65, transform: `translateX(-${tailShift}px)` },
      { offset: 0.72, transform: "translateX(0)" },
      { offset: 1, transform: "translateX(0)" },
    ], { duration, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" });

    const cleanupTimer = later(() => finish(), duration + 100);

    function placeLetter() {
      letter.style.opacity = "1";
      placementAnimation = letter.animate([
        { transform: "translateY(-4px) scale(1.06)" },
        { transform: "translateY(2px) scale(.98)" },
        { transform: "translateY(0) scale(1)" },
      ], { duration: 420 * speed, easing: "cubic-bezier(.16,1.35,.3,1)" });
    }

    function finish() {
      if (cleaned) return;
      cleaned = true;
      forgetTimer(cleanupTimer);
      letterAnimation.cancel();
      tailAnimation.cancel();
      if (placementAnimation) placementAnimation.cancel();
      letter.style.opacity = "";
      letter.style.transform = "";
      tail.style.transform = "";
      clone.remove();
      body.classList.remove("dot-pet-scene-running");
      if (activeCleanup === finish) activeCleanup = null;
    }

    activeCleanup = finish;
    primeRobot(global.innerWidth + 48, dropY + 12);
    engine.repairText(letter, {
      glyph: "o",
      dropX,
      dropY,
      renderGlyph: false,
      onPlace: placeLetter,
      after: "hide",
    });
  }

  function playAppsNudge(letter, rect) {
    activeName = "apps-nudge";
    const duration = 2500 * speed;
    let cleaned = false;
    const nudge = letter.animate([
      { offset: 0, transform: "translateY(0) rotate(0deg)" },
      { offset: 0.25, transform: "translateY(8px) rotate(8deg)" },
      { offset: 0.48, transform: "translateY(8px) rotate(8deg)" },
      { offset: 0.68, transform: "translateY(-3px) rotate(-3deg)" },
      { offset: 1, transform: "translateY(0) rotate(0deg)" },
    ], { duration, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" });
    const timer = later(() => finish(), duration + 80);

    function finish() {
      if (cleaned) return;
      cleaned = true;
      forgetTimer(timer);
      nudge.cancel();
      letter.style.transform = "";
      if (activeCleanup === finish) activeCleanup = null;
    }

    activeCleanup = finish;
    const side = "right";
    const y = Math.max(82, Math.min(global.innerHeight - 72, rect.top + rect.height / 2));
    primeRobot(global.innerWidth + 46, y);
    engine.play("peek", { side, y, short: true, hideAfter: true, after: "hide" });
  }

  function playLabInspection(attempt = 0) {
    if (!engine || primaryPlayed || site !== "lab" || route !== "directory") return;
    const card = document.querySelector("[data-pet-lab-card]");
    if (!card || isBusy() || !visibleEnough(card, 72)) {
      if (attempt < 55) later(() => playLabInspection(attempt + 1), 1000);
      return;
    }

    primaryPlayed = true;
    const rect = card.getBoundingClientRect();
    if (global.innerWidth < 900 || !finePointer.matches) {
      activeName = "lab-peek";
      const y = Math.max(90, Math.min(global.innerHeight - 76, rect.top + 58));
      primeRobot(global.innerWidth + 48, y);
      engine.play("peek", { side: "right", y, short: true, hideAfter: true, after: "hide" });
      return;
    }

    activeName = "lab-inspect";
    const duration = 5500 * speed;
    const washer = document.createElement("span");
    const label = document.createElement("span");
    washer.className = "dot-pet-washer";
    washer.setAttribute("aria-hidden", "true");
    label.className = "dot-pet-bench-label";
    label.setAttribute("aria-hidden", "true");
    label.textContent = "bench check · pass";
    washer.style.left = `${rect.right - 30}px`;
    washer.style.top = `${rect.top - 5}px`;
    label.style.left = `${Math.min(rect.right - 124, rect.left + 18)}px`;
    label.style.top = `${rect.top + 18}px`;
    body.append(washer, label);

    const travel = -Math.min(210, rect.width * 0.46);
    const washerAnimation = washer.animate([
      { offset: 0, transform: "translate3d(0,0,0) rotate(0deg)", opacity: 0 },
      { offset: 0.08, opacity: 1 },
      { offset: 0.32, transform: `translate3d(${travel}px,0,0) rotate(-650deg)`, opacity: 1 },
      { offset: 0.45, transform: `translate3d(${travel - 8}px,0,0) rotate(-690deg)` },
      { offset: 0.7, transform: "translate3d(-22px,0,0) rotate(-1080deg)" },
      { offset: 0.86, transform: "translate3d(-8px,4px,0) rotate(-1180deg)", opacity: 1 },
      { offset: 1, transform: "translate3d(-8px,24px,0) rotate(-1260deg)", opacity: 0 },
    ], { duration, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
    const labelAnimation = label.animate([
      { offset: 0, opacity: 0, transform: "translateY(5px)" },
      { offset: 0.58, opacity: 0, transform: "translateY(5px)" },
      { offset: 0.67, opacity: 1, transform: "translateY(0)" },
      { offset: 0.84, opacity: 1, transform: "translateY(0)" },
      { offset: 1, opacity: 0, transform: "translateY(-4px)" },
    ], { duration, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" });
    let cleaned = false;
    const timer = later(() => finish(), duration + 90);

    function finish() {
      if (cleaned) return;
      cleaned = true;
      forgetTimer(timer);
      washerAnimation.cancel();
      labelAnimation.cancel();
      washer.remove();
      label.remove();
      if (activeCleanup === finish) activeCleanup = null;
    }

    activeCleanup = finish;
    const gridRect = card.parentElement?.getBoundingClientRect() || rect;
    const inspectionPoint = {
      x: Math.min(global.innerWidth - 26, gridRect.right + 30),
      y: Math.max(88, Math.min(global.innerHeight - 74, rect.top + rect.height * 0.34)),
    };
    primeRobot(global.innerWidth + 48, inspectionPoint.y);
    engine.play("inspect", { target: card, position: inspectionPoint, after: "hide" });
  }

  function play404Repair(attempt = 0) {
    if (!engine || primaryPlayed || route !== "404") return;
    const zero = document.querySelector("[data-pet-404], .error-zero");
    if (!zero || isBusy() || !visibleEnough(zero, 26)) {
      if (attempt < 22) later(() => play404Repair(attempt + 1), 700);
      return;
    }

    primaryPlayed = true;
    activeName = "404-repair";
    const rect = zero.getBoundingClientRect();
    const duration = 7600 * speed;
    zero.classList.add("dot-pet-zero-active");
    const zeroAnimation = zero.animate([
      { offset: 0, transform: "translate3d(0,0,0) rotate(0deg)" },
      { offset: 0.25, transform: "translate3d(0,0,0) rotate(0deg)" },
      { offset: 0.31, transform: "translate3d(-2px,0,0) rotate(-2deg)" },
      { offset: 0.37, transform: "translate3d(3px,0,0) rotate(4deg)" },
      { offset: 0.45, transform: "translate3d(-5px,1px,0) rotate(-7deg)" },
      { offset: 0.54, transform: "translate3d(38px,-4px,0) rotate(11deg)" },
      { offset: 0.61, transform: "translate3d(27px,2px,0) rotate(7deg)" },
      { offset: 0.72, transform: "translate3d(-9px,0,0) rotate(-3deg)" },
      { offset: 0.81, transform: "translate3d(5px,0,0) rotate(2deg)" },
      { offset: 0.9, transform: "translate3d(-2px,0,0) rotate(-1deg)" },
      { offset: 1, transform: "translate3d(0,0,0) rotate(0deg)" },
    ], { duration, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
    let cleaned = false;
    const timer = later(() => finish(), duration + 90);

    function finish() {
      if (cleaned) return;
      cleaned = true;
      forgetTimer(timer);
      zeroAnimation.cancel();
      zero.classList.remove("dot-pet-zero-active");
      zero.style.transform = "";
      if (activeCleanup === finish) activeCleanup = null;
    }

    activeCleanup = finish;
    primeRobot(rect.left + rect.width * 0.52, rect.top + rect.height * 0.58);
    engine.play("repair-404", { target: zero, after: "hide" });
  }

  function runPrimary() {
    if (!engine || primaryPlayed) return;
    if (debugScene === "desk") {
      primaryPlayed = true;
      playDesk();
      return;
    }
    if (debugScene === "peek") {
      playPeek();
      return;
    }
    if (route === "404" || debugScene === "404") play404Repair();
    else if (site === "apps" || debugScene === "apps") playAppsRepair();
    else if (site === "lab" || debugScene === "lab") playLabInspection();
    else if (route === "home" || debugScene === "main") playMainIntro();
    else schedulePeek(true);
  }

  function startDirector() {
    if (engine || !enabled || reducedMotion.matches) return;
    engine = global.DotPet.init({
      context: route === "404" ? "404" : site,
      autoEmerge: false,
      disableOnTouch: false,
      followPointerAfterExit: finePointer.matches,
      reducedMotion: "hide",
      robotLifetime: 2200,
      scale: global.innerWidth < 600 ? 0.82 : 1,
    });

    if (!engine || !engine.ctx) {
      if (engine) global.DotPet.destroy();
      engine = null;
      return;
    }

    const baseDuration = engine.sceneDuration.bind(engine);
    engine.sceneDuration = (name, options) => baseDuration(name, options) * speed;
    refreshPalette();

    if (finePointer.matches) html.classList.add("dot-pet-active");
    else engine.dismiss({ immediate: true });

    themeObserver = new MutationObserver(refreshPalette);
    themeObserver.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    const errorCanvas = document.getElementById("errorCanvas");
    if (errorCanvas) themeObserver.observe(errorCanvas, { attributes: true, attributeFilter: ["data-error-palette"] });

    primaryPlayed = false;
    activeName = null;
    later(runPrimary, debugScene ? 650 : (route === "home" ? 6100 : 3600));
  }

  function stopDirector() {
    cancelCurrent({ scheduleAmbient: false });
    clearTimers();
    if (themeObserver) themeObserver.disconnect();
    themeObserver = null;
    if (engine) global.DotPet.destroy();
    engine = null;
    html.classList.remove("dot-pet-active", "dot-pet-detached");
    activeName = null;
    peekScheduled = false;
  }

  global.addEventListener("dotpet:sceneend", (event) => {
    if (!engine || event.detail.engine !== engine) return;
    activeName = null;
    if (primaryPlayed && !peekScheduled) schedulePeek(true);
  });

  global.addEventListener("scroll", () => {
    lastScrollAt = performance.now();
    if (activeName && activeName !== "peek") cancelCurrent();
  }, { passive: true });

  global.addEventListener("resize", () => {
    lastResizeAt = performance.now();
    if (engine) engine.options.scale = global.innerWidth < 600 ? 0.82 : 1;
    if (activeName) cancelCurrent();
  }, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && activeName) cancelCurrent({ scheduleAmbient: false });
  });

  const shuffle = document.getElementById("errorShuffle");
  if (shuffle) {
    shuffle.addEventListener("click", () => {
      if (!engine) return;
      cancelCurrent({ scheduleAmbient: false });
      later(() => {
        if (!isBusy()) playPeek({ side: "right" });
      }, 650);
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.shiftKey && event.key.toLowerCase() === "d" && engine) {
      event.preventDefault();
      cancelCurrent({ scheduleAmbient: false });
      primaryPlayed = false;
      runPrimary();
    }
  });

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) stopDirector();
    else if (enabled) startDirector();
    updateToggle();
  });

  createToggle();
  if (enabled && !reducedMotion.matches) startDirector();
  global.DotDirector = { start: startDirector, stop: stopDirector, replay: runPrimary, cancel: cancelCurrent };
})(window);
