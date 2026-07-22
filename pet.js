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
        label: "Dot, a tiny seated coding companion",
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
      const firstMove = !this.pointer.seen;
      const dx = firstMove ? 0 : event.clientX - this.pointer.x;
      const dy = firstMove ? 0 : event.clientY - this.pointer.y;
      this.pointer.speed = firstMove ? 0 : Math.hypot(dx, dy);
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.seen = true;
      if (firstMove && this.mode === "dot") {
        const offset = this.options.followOffset;
        this.teleport(event.clientX + offset.x, event.clientY + offset.y);
      }
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
      actor.x = damp(actor.x, targetX, 14, dt);
      actor.y = damp(actor.y, targetY, 14, dt);
      actor.morph = damp(actor.morph, 0, 18, dt);
      actor.opacity = damp(actor.opacity, this.pointer.seen ? 1 : 0, 14, dt);
      actor.squash = 0;

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
            ? clamp(position.y, 68, scene.options.ledge ? this.height + 4 : this.height - 54)
            : clamp(target.y + Math.max(36, target.height * 0.2), 58, this.height - 54);
          actor.x = damp(actor.x, desiredX, t < 0.34 ? 2.4 : 5.5, dt);
          actor.y = damp(actor.y, desiredY, t < 0.34 ? 2.4 : 5.5, dt);
          actor.heading = target.x > actor.x ? 1 : -1;
          break;
        }
        case "desk": {
          const deskX = clamp(target.x, 62, this.width - 62);
          const deskY = clamp(target.y, 68, this.height + 4);
          if (t < 0.16) {
            const enter = easeOutBack(invLerp(0, 0.16, t), 0.65);
            actor.x = lerp(scene.fromX, deskX, enter);
            actor.y = lerp(scene.fromY, deskY, enter) - Math.sin(enter * Math.PI) * 11;
          } else if (t < 0.9) {
            actor.x = damp(actor.x, deskX, 10, dt);
            actor.y = damp(actor.y, deskY, 10, dt);
            actor.squash = 0;
          } else {
            const leave = easeInOutCubic(invLerp(0.88, 1, t));
            const exitX = deskX < this.width / 2 ? -82 : this.width + 82;
            actor.x = lerp(deskX, exitX, leave);
            actor.y = deskY - Math.sin(leave * Math.PI) * 10;
          }
          break;
        }
        case "text-repair": {
          const position = scene.options.position;
          if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
            actor.x = damp(actor.x, clamp(position.x, 56, this.width - 56), t < 0.18 ? 3.6 : 9, dt);
            actor.y = damp(actor.y, clamp(position.y, 68, this.height + 4), t < 0.18 ? 3.6 : 9, dt);
            actor.heading = target.x > actor.x ? 1 : -1;
            if (t > 0.69 && !scene.placed) {
              scene.placed = true;
              this.burst(target.x, target.y, this.palette.accent, 12, 1.15);
              if (typeof scene.options.onPlace === "function") scene.options.onPlace(target.element || target);
              this.emit("place", { name: scene.name, target: target.element || target, glyph: scene.options.glyph || "o" });
            }
            break;
          }
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
          const workY = clamp(target.y + Math.min(52, target.height * 0.24), 68, this.height + 4);
          if (t < 0.2) {
            const enter = easeOutBack(invLerp(0, 0.2, t), 0.8);
            actor.x = lerp(scene.fromX, workX, enter);
            actor.y = lerp(scene.fromY, workY, enter) - Math.sin(enter * Math.PI) * 22;
          } else {
            actor.x = damp(actor.x, workX, 8, dt);
            actor.y = damp(actor.y, workY, 8, dt);
            actor.heading = target.x > actor.x ? 1 : -1;
            actor.squash = 0;
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
      const bob = 0;
      const cursorSeed = this.mode === "dot" && actor.morph < 0.001;
      const movingSquash = cursorSeed ? 0 : clamp(Math.abs(actor.vx) / 900, 0, 0.12);

      ctx.save();
      ctx.globalAlpha = actor.opacity;
      ctx.translate(actor.x, actor.y - clickHop + bob);
      ctx.rotate(sceneSpin);
      if (cursorSeed) {
        ctx.scale(baseScale, baseScale);
      } else {
        ctx.scale(
          actor.heading * baseScale * (1 + actor.squash * 0.22 + movingSquash),
          baseScale * (1 - actor.squash * 0.28 - clickSquash),
        );
      }
      this.drawActor(ctx, time);
      ctx.restore();
      if (this.debugVisible) this.drawDebug(ctx);
    }

    drawActionLines(ctx, time) {
      const actor = this.actor;
      const fast = this.scene && (
        this.scene.name === "panic" ||
        this.scene.name === "spin"
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
      ctx.save();
      ctx.globalAlpha *= alpha * 0.18;
      ctx.fillStyle = this.palette.ink;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
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
      const sleeping = scene && scene.name === "sleep";
      const panic = scene && scene.name === "panic";
      const repairing = scene && scene.name === "repair-404" && sceneT > 0.24 && sceneT < 0.72;
      const inspecting = scene && scene.name === "inspect";
      const waving = scene && (
        scene.name === "wave" ||
        scene.name === "peek" ||
        (scene.name === "home-intro" && sceneT > 0.34 && sceneT < 0.67) ||
        (scene.name === "desk" && sceneT > 0.6 && sceneT < 0.76)
      );
      const typing = !sleeping && !panic && !waving;
      const cream = "#f2eee3";
      const charcoal = "#171914";
      const breathe = sleeping ? 0 : Math.sin(time * 0.0026) * 0.65;
      const lean = panic ? Math.sin(time * 0.04) * 0.055 : (inspecting ? -0.035 : 0);

      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.rotate(lean);

      this.drawDanglingLegs(ctx, time, { cream, charcoal, panic });

      ctx.save();
      ctx.translate(0, breathe * 0.35);
      roundedRect(ctx, -22, -43, 44, 42, 14);
      ctx.fillStyle = charcoal;
      ctx.fill();
      ctx.strokeStyle = this.palette.ink;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.strokeStyle = this.palette.accent;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, -35, 13, 0.18, Math.PI - 0.18);
      ctx.stroke();

      this.drawCompanionFace(ctx, time, { cream, charcoal, sleeping, panic, inspecting });
      this.drawCompanionArm(ctx, -1, time, { cream, charcoal, typing, waving: false });
      this.drawCompanionArm(ctx, 1, time, { cream, charcoal, typing, waving });
      ctx.restore();

      this.drawLaptop(ctx, time, sceneT);

      if (sleeping) this.drawSleepMarks(ctx, time);
      if (inspecting) this.drawScanner(ctx, time, sceneT);
      if (repairing) this.drawRepairPatch(ctx, time);
      if (panic) this.drawPanicMark(ctx, time);
      ctx.restore();
    }

    drawDanglingLegs(ctx, time, colors) {
      const still = this.scene && (this.scene.name === "sleep" || this.scene.name === "repair-404");
      for (const side of [-1, 1]) {
        const swing = still ? 0 : Math.sin(time * 0.0032 + side * 1.4) * 2.6;
        const kick = colors.panic ? Math.sin(time * 0.024 + side) * 6 : 0;
        ctx.save();
        ctx.strokeStyle = colors.charcoal;
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(side * 9, -3);
        ctx.lineTo(side * 10, 10);
        ctx.lineTo(side * (12 + swing) + kick, 23);
        ctx.stroke();

        ctx.fillStyle = colors.cream;
        ctx.strokeStyle = this.palette.ink;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.ellipse(side * (15 + swing) + kick, 25, 7, 3.6, side * 0.08, 0, TAU);
        ctx.fill();
        ctx.stroke();
        if (side === 1) {
          ctx.strokeStyle = this.palette.accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(11 + swing + kick, 21);
          ctx.lineTo(16 + swing + kick, 23);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    drawCompanionArm(ctx, side, time, colors) {
      const shoulder = { x: side * 16, y: -29 };
      let elbow = { x: side * 19, y: -20 };
      let hand = {
        x: side * 9,
        y: -21 + (colors.typing ? Math.abs(Math.sin(time * 0.018 + side * 1.8)) * 2 : 0),
      };

      if (colors.waving && side === 1) {
        const wave = Math.sin(time * 0.015) * 0.24;
        elbow = { x: 24, y: -42 };
        hand = { x: 28 + Math.sin(wave) * 5, y: -56 + Math.cos(wave) * 2 };
      }

      ctx.save();
      ctx.strokeStyle = colors.charcoal;
      ctx.lineWidth = 6.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.lineTo(hand.x, hand.y);
      ctx.stroke();
      ctx.fillStyle = colors.cream;
      ctx.strokeStyle = colors.charcoal;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, colors.waving ? 4.8 : 4.1, 0, TAU);
      ctx.fill();
      ctx.stroke();
      if (colors.waving) {
        ctx.strokeStyle = colors.cream;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(hand.x - 1.5, hand.y - 3.5);
        ctx.lineTo(hand.x - 2, hand.y - 7.5);
        ctx.moveTo(hand.x + 1, hand.y - 3.6);
        ctx.lineTo(hand.x + 2, hand.y - 7.2);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawCompanionFace(ctx, time, expression) {
      const headY = -48 + (expression.sleeping ? 4 : 0);
      const blink = expression.sleeping ? 0.08 : this.actor.blink;
      const gazeX = clamp(this.actor.gazeX * 1.1, -1.2, 1.2);
      const gazeY = expression.inspecting ? 0.8 : clamp(this.actor.gazeY * 0.7, -0.8, 0.8);

      ctx.save();
      ctx.translate(expression.sleeping ? 3 : 0, 0);
      ctx.fillStyle = expression.cream;
      ctx.strokeStyle = expression.charcoal;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, headY, 15.5, 14.2, expression.sleeping ? 0.08 : -0.03, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = expression.charcoal;
      ctx.beginPath();
      ctx.moveTo(-14.5, headY - 2);
      ctx.bezierCurveTo(-14, headY - 13, -5, headY - 17, 4, headY - 14);
      ctx.bezierCurveTo(10, headY - 12, 14, headY - 8, 14.5, headY - 3);
      ctx.bezierCurveTo(8, headY - 7, 3, headY - 6, -2, headY - 8);
      ctx.bezierCurveTo(-5, headY - 5, -10, headY - 4, -14.5, headY - 2);
      ctx.fill();

      ctx.fillStyle = expression.charcoal;
      const eyeHeight = Math.max(0.45, (expression.panic ? 2.3 : 1.45) * blink);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * 4.5 + gazeX, headY + gazeY, expression.panic ? 1.9 : 1.35, eyeHeight, 0, 0, TAU);
        ctx.fill();
      }

      if (!expression.sleeping) {
        ctx.strokeStyle = expression.charcoal;
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0.5, headY + 3.4, 3.2, 0.25, Math.PI - 0.2);
        ctx.stroke();
      }
      ctx.restore();
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
      const logoPulse = 0.82 + Math.sin(time * 0.005) * 0.16;
      ctx.save();
      ctx.fillStyle = "#11130f";
      ctx.strokeStyle = this.palette.ink;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-24, -30);
      ctx.lineTo(24, -30);
      ctx.lineTo(20, -3);
      ctx.lineTo(-20, -3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha *= logoPulse;
      ctx.fillStyle = this.palette.accent;
      roundedRect(ctx, -5, -19, 10, 7, 2.5);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#f2eee3";
      ctx.strokeStyle = "#11130f";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-27, -3);
      ctx.lineTo(27, -3);
      ctx.lineTo(22, 1.5);
      ctx.lineTo(-22, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
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

    drawRepairPatch(ctx, time) {
      ctx.save();
      ctx.translate(31, -9);
      ctx.rotate(Math.sin(time * 0.018) * 0.12);
      ctx.fillStyle = this.palette.accent;
      ctx.strokeStyle = "#11130f";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, 0, 5.2, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#11130f";
      ctx.beginPath();
      ctx.arc(0, 0, 1.4, 0, TAU);
      ctx.fill();
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

  function seatIsClear(point, source) {
    const scale = global.innerWidth < 600 ? 0.72 : (global.innerWidth < 900 ? 0.86 : 1);
    const footprint = {
      left: point.x - 38 * scale,
      right: point.x + 38 * scale,
      top: point.y - 64 * scale,
      bottom: point.y + 28 * scale,
    };
    const blockers = document.querySelectorAll(
      "h1, h2, h3, p, img, button, .button, .logo, .nav-links, .directory-card-top, .directory-card-foot"
    );
    return !Array.from(blockers).some((element) => {
      if (!element.isConnected || element === source) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        footprint.right > rect.left && footprint.left < rect.right &&
        footprint.bottom > rect.top && footprint.top < rect.bottom;
    });
  }

  function pointOnLedge(candidate) {
    const element = typeof candidate.selector === "string"
      ? document.querySelector(candidate.selector)
      : candidate.element;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const edge = candidate.edge || "bottom";
    const y = edge === "top" ? rect.top : rect.bottom;
    if (rect.width < 90 || y < 70 || y > global.innerHeight + 3) return null;

    const pad = global.innerWidth < 600 ? 34 : 56;
    const positions = [];
    if (candidate.grid) {
      const children = Array.from(element.children).filter((child) => child.getBoundingClientRect().width > 0);
      if (children.length > 1) {
        const first = children[0].getBoundingClientRect();
        const second = children[1].getBoundingClientRect();
        if (Math.abs(first.top - second.top) < 3) positions.push(first.right);
      }
    }
    const ratios = candidate.ratios || [candidate.ratio || 0.7, 0.55, 0.82, 0.38];
    ratios.forEach((ratio) => positions.push(rect.left + rect.width * ratio));

    for (const rawX of positions) {
      const point = {
        x: Math.min(global.innerWidth - pad, Math.max(pad, rawX)),
        y,
        element,
        edge,
      };
      if (seatIsClear(point, element)) return point;
    }
    return null;
  }

  function findSeatLedge(preferred = []) {
    const defaults = route === "404" ? [] : [
      { selector: ".home-hero", edge: "bottom", ratios: [0.63, 0.54, 0.76] },
      { selector: ".directory-hero", edge: "bottom", ratios: [0.52, 0.64, 0.38, 0.78] },
      { selector: ".interior-hero", edge: "bottom", ratios: [0.84, 0.72, 0.58] },
      { selector: ".header", edge: "bottom", ratios: [0.54, 0.46, 0.62] },
      { selector: ".project-grid", edge: "top", grid: true },
      { selector: ".network-grid", edge: "top", grid: true },
      { selector: ".directory-grid", edge: "top", grid: true },
      { selector: ".interior-section", edge: "bottom", ratios: [0.82, 0.68, 0.46] },
      { selector: ".cv-section", edge: "bottom", ratios: [0.82, 0.68, 0.46] },
      { selector: ".interior-updated", edge: "bottom", ratios: [0.78, 0.58] },
      { selector: "footer", edge: "top", ratios: [0.72, 0.52, 0.86] },
    ];
    for (const candidate of [...preferred, ...defaults]) {
      const point = pointOnLedge(candidate);
      if (point) return point;
    }
    return null;
  }

  function resetToCursor() {
    if (!engine) return;
    engine.scene = null;
    engine.pendingScene = null;
    document.documentElement.classList.remove("dot-pet-detached");
    engine.dismiss({ immediate: true });
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

  function playDesk(options = {}) {
    if (!engine || isBusy() || peekCount >= 3 || route === "404") return false;
    const seat = options.seat || findSeatLedge(options.preferred || []);
    if (!seat) return false;

    activeName = "desk";
    peekCount += 1;
    const startX = seat.x < global.innerWidth / 2 ? -74 : global.innerWidth + 74;
    primeRobot(startX, seat.y);
    engine.play("desk", { target: seat, ledge: true, after: "hide" });
    return true;
  }

  function schedulePeek(initial = false) {
    if (!engine || peekScheduled || peekCount >= 3) return;
    peekScheduled = true;
    const delay = debugScene === "peek" ? 650 : (initial ? randomMs(25000, 40000) : randomMs(55000, 85000));
    later(() => {
      peekScheduled = false;
      const played = debugScene === "peek" ? playPeek() : playDesk();
      if (!played) schedulePeek(false);
    }, delay);
  }

  function randomMs(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function playMainIntro(attempt = 0) {
    if (!engine || primaryPlayed || route !== "home") return;
    const seat = findSeatLedge([
      { selector: ".home-hero", edge: "bottom", ratios: [0.63, 0.54, 0.76] },
      { selector: ".header", edge: "bottom", ratios: [0.54, 0.46, 0.62] },
    ]);
    if (!seat || isBusy()) {
      if (attempt < 24) later(() => playMainIntro(attempt + 1), 750);
      else schedulePeek(true);
      return;
    }

    primaryPlayed = true;
    playDesk({ seat });
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
    const seat = findSeatLedge([
      { selector: ".directory-hero", edge: "bottom", ratios: [0.52, 0.64, 0.38, 0.78] },
      { selector: ".directory-grid", edge: "top", grid: true },
    ]);

    if (isBusy() || !visibleEnough(letter, 54) || !seat) {
      if (attempt < 28) later(() => playAppsRepair(attempt + 1), 900);
      return;
    }

    primaryPlayed = true;
    if (global.innerWidth < 820 || !finePointer.matches) {
      playAppsNudge(letter, rect, seat);
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
    primeRobot(global.innerWidth + 74, seat.y);
    engine.repairText(letter, {
      glyph: "o",
      dropX,
      dropY,
      position: seat,
      ledge: true,
      renderGlyph: false,
      onPlace: placeLetter,
      after: "hide",
    });
  }

  function playAppsNudge(letter, rect, seat) {
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
    primeRobot(global.innerWidth + 74, seat.y);
    engine.play("desk", { target: seat, ledge: true, short: true, after: "hide" });
  }

  function playLabInspection(attempt = 0) {
    if (!engine || primaryPlayed || site !== "lab" || route !== "directory") return;
    const card = document.querySelector("[data-pet-lab-card]");
    if (!card || isBusy() || !visibleEnough(card, 72)) {
      if (attempt < 55) later(() => playLabInspection(attempt + 1), 1000);
      return;
    }

    const rect = card.getBoundingClientRect();
    const grid = card.parentElement;
    const seat = findSeatLedge([
      { element: grid, edge: "top", grid: true },
      { element: card, edge: "top", ratios: [0.86, 0.72, 0.58] },
      { selector: ".directory-hero", edge: "bottom", ratios: [0.52, 0.68, 0.38] },
    ]);
    if (!seat) {
      if (attempt < 55) later(() => playLabInspection(attempt + 1), 1000);
      return;
    }

    primaryPlayed = true;
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
    primeRobot(global.innerWidth + 74, seat.y);
    engine.play("inspect", { target: card, position: seat, ledge: true, after: "hide" });
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
      if (playDesk()) primaryPlayed = true;
      else later(runPrimary, 900);
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
      followPointerAfterExit: false,
      reducedMotion: "hide",
      robotLifetime: 2200,
      scale: global.innerWidth < 600 ? 0.72 : (global.innerWidth < 900 ? 0.86 : 1),
    });

    if (!engine || !engine.ctx) {
      if (engine) global.DotPet.destroy();
      engine = null;
      return;
    }

    const baseDuration = engine.sceneDuration.bind(engine);
    engine.sceneDuration = (name, options) => baseDuration(name, options) * speed;
    refreshPalette();

    engine.dismiss({ immediate: true });

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
    if (engine) engine.options.scale = global.innerWidth < 600 ? 0.72 : (global.innerWidth < 900 ? 0.86 : 1);
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
      primaryPlayed = false;
      later(() => {
        if (!isBusy()) play404Repair();
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
