"use client";

/**
 * Animation & pixel-art QA harness (dev only).
 *
 * Loads the locally generated art document (`npm run art:preview`) and plays
 * every actor through the exact runtime used in-game: sampleClip +
 * EntityAnimator crossfades + computeMotionPose secondary motion. What looks
 * right here looks right in the game.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnimationDocument, EntityAnimationState } from "@holdout/shared";
import {
  EntityAnimator,
  attackLungePx,
  clipTotalMs,
  computeMotionPose,
  sampleClip,
} from "@/game/animation";

interface PreviewAsset {
  name: string;
  width: number;
  height: number;
  renderScale?: number;
  frames: string[][];
}

interface PreviewDocument {
  generatedAt: string;
  assets: Record<string, PreviewAsset>;
  animations: AnimationDocument;
}

const STATES: EntityAnimationState[] = ["idle", "walk", "attack", "punch", "hit", "death"];
type PlayMode = EntityAnimationState | "cycle";

/** Scripted state schedule for cycle mode (mirrors real gameplay pacing). */
const CYCLE: { state: EntityAnimationState; ms: number }[] = [
  { state: "idle", ms: 1600 },
  { state: "walk", ms: 2400 },
  { state: "idle", ms: 700 },
  { state: "attack", ms: 900 },
  { state: "punch", ms: 900 },
  { state: "hit", ms: 600 },
  { state: "walk", ms: 1500 },
  { state: "death", ms: 1800 },
];
const CYCLE_TOTAL = CYCLE.reduce((sum, step) => sum + step.ms, 0);

function frameToCanvas(frame: string[], width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(width, height);
  for (let index = 0; index < frame.length; index++) {
    const match = /^#([0-9a-f]{8})$/i.exec(frame[index] ?? "");
    if (!match) continue;
    const value = match[1];
    image.data[index * 4] = parseInt(value.slice(0, 2), 16);
    image.data[index * 4 + 1] = parseInt(value.slice(2, 4), 16);
    image.data[index * 4 + 2] = parseInt(value.slice(4, 6), 16);
    image.data[index * 4 + 3] = parseInt(value.slice(6, 8), 16);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

interface ActorRig {
  target: string;
  label: string;
  spriteId: string;
  frames: HTMLCanvasElement[];
  renderScale: number;
  animator: EntityAnimator;
  cycleOffsetMs: number;
  stateStartedAt: number;
  currentState: EntityAnimationState;
}

export default function AnimationLab() {
  const [doc, setDoc] = useState<PreviewDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PlayMode>("cycle");
  const [moveSpeed, setMoveSpeed] = useState(170);
  const [zoom, setZoom] = useState(2);
  const [timeScale, setTimeScale] = useState(1);
  const [useBlend, setUseBlend] = useState(true);
  const [useBob, setUseBob] = useState(true);
  const [showAnchors, setShowAnchors] = useState(false);
  const [stripTarget, setStripTarget] = useState<string>("player");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch("/dev-art-preview.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setDoc)
      .catch(() => setError("No preview document. Run `npm run art:preview` and reload."));
  }, []);

  const rigs = useMemo<ActorRig[] | null>(() => {
    if (!doc) return null;
    const built: ActorRig[] = [];
    let index = 0;
    for (const [target, profile] of Object.entries(doc.animations)) {
      const asset = doc.assets[profile.spriteId];
      if (!asset?.frames?.length) continue;
      built.push({
        target,
        label: target.replace(/^mob:/, ""),
        spriteId: profile.spriteId,
        frames: asset.frames.map((frame) => frameToCanvas(frame, asset.width, asset.height)),
        renderScale: asset.renderScale ?? 2,
        animator: new EntityAnimator(),
        cycleOffsetMs: index * 260,
        stateStartedAt: 0,
        currentState: "idle",
      });
      index++;
    }
    return built;
  }, [doc]);

  // Drive the animation grid.
  useEffect(() => {
    if (!rigs || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const columns = 4;
    const cellW = 220;
    const cellH = 190;
    const rows = Math.ceil(rigs.length / columns);
    canvas.width = columns * cellW;
    canvas.height = rows * cellH;

    let raf = 0;
    let last = performance.now();
    let clock = 0;
    const animations = doc!.animations;
    // The loop clock restarts with this effect; rig playback state must too.
    for (const rig of rigs) {
      rig.animator = new EntityAnimator();
      rig.currentState = "idle";
      rig.stateStartedAt = 0;
    }

    const stripBlend = (profile: (typeof animations)[string]) => {
      if (useBlend) return profile;
      const clips = Object.fromEntries(
        Object.entries(profile.clips).map(([key, value]) => [key, value ? { ...value, blendMs: 0 } : value]),
      );
      return { ...profile, clips };
    };

    const tick = (now: number) => {
      const dtMs = Math.min(100, now - last) * timeScale;
      last = now;
      clock += dtMs;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#20251f";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      rigs.forEach((rig, rigIndex) => {
        const col = rigIndex % columns;
        const row = Math.floor(rigIndex / columns);
        const originX = col * cellW + cellW / 2;
        const originY = row * cellH + cellH * 0.62;

        // Resolve the state exactly like the game: attacks/hits/deaths are
        // timestamped events, walk/idle persist.
        let state: EntityAnimationState;
        if (mode === "cycle") {
          const at = (clock + rig.cycleOffsetMs) % CYCLE_TOTAL;
          let acc = 0;
          state = "idle";
          for (const step of CYCLE) {
            acc += step.ms;
            if (at < acc) { state = step.state; break; }
          }
        } else {
          state = mode;
        }
        if (state !== rig.currentState) {
          rig.currentState = state;
          rig.stateStartedAt = clock;
        }
        const stateElapsed = Math.max(0, clock - rig.stateStartedAt);
        const profile = stripBlend(animations[rig.target]);
        const moving = state === "walk";
        const speed = moving ? moveSpeed : 0;
        const walkTotal = clipTotalMs(profile.clips.walk, 420);
        const plan = rig.animator.update(clock, dtMs, state, stateElapsed, speed, walkTotal, false);
        const pose = computeMotionPose({
          moving,
          time: clock / 1000,
          seed: rigIndex * 131,
          vx: moving ? speed : 0,
          vy: 0,
          hitElapsedMs: state === "hit" ? stateElapsed : Infinity,
          strideCycle: moving ? plan.strideCycle : undefined,
          transitionAgeS: stateElapsed / 1000,
          reducedMotion: !useBob,
        });
        const actionDuration = state === "attack" || state === "punch"
          ? clipTotalMs(profile.clips[state], 500)
          : 0;
        const lunge = actionDuration > 0 ? attackLungePx(Math.min(1, stateElapsed / actionDuration)) : 0;
        const bodyX = originX + pose.x + lunge;
        const bodyY = originY + pose.y;

        // shadow
        const spriteH = rig.frames[0].height * rig.renderScale * zoom;
        const spriteW = rig.frames[0].width * rig.renderScale * zoom;
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.ellipse(originX, originY + spriteH * 0.28, Math.max(9, spriteW * 0.16) * pose.shadowScale, 4 * pose.shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();

        const drawFrame = (frameIndex: number, alpha: number) => {
          if (alpha <= 0.02) return;
          const frame = rig.frames[Math.max(0, Math.min(rig.frames.length - 1, frameIndex))];
          const w = frame.width * rig.renderScale * zoom;
          const h = frame.height * rig.renderScale * zoom;
          const prev = ctx.globalAlpha;
          if (alpha < 1) ctx.globalAlpha = prev * alpha;
          ctx.drawImage(frame, bodyX - w / 2, bodyY - h / 2, w, h);
          ctx.globalAlpha = prev;
        };

        ctx.save();
        ctx.translate(bodyX, bodyY);
        ctx.rotate(pose.lean);
        ctx.translate(-bodyX, -bodyY);
        const clip = profile.clips[plan.state] ?? profile.clips.idle;
        if (plan.fade) {
          const fadeClip = profile.clips[plan.fade.state] ?? profile.clips.idle;
          const fadeSample = sampleClip(fadeClip, plan.fade.state, plan.fade.elapsedMs, rigIndex, false);
          drawFrame(fadeSample.frame, plan.fade.alpha);
        }
        const sample = sampleClip(clip, plan.state, plan.elapsedMs, rigIndex, false);
        if (sample.blendFrame !== undefined && sample.blendAlpha < 1) {
          drawFrame(sample.blendFrame, 1 - sample.blendAlpha);
          drawFrame(sample.frame, sample.blendAlpha);
        } else {
          drawFrame(sample.frame, plan.fade ? 1 - plan.fade.alpha : 1);
        }
        ctx.restore();

        if (showAnchors) {
          ctx.strokeStyle = "rgba(120,220,255,0.5)";
          ctx.beginPath();
          ctx.moveTo(originX - 20, originY);
          ctx.lineTo(originX + 20, originY);
          ctx.moveTo(originX, originY - 20);
          ctx.lineTo(originX, originY + 20);
          ctx.stroke();
        }

        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#dcd8c8";
        ctx.fillText(`${rig.label} · ${state} f${sample.frame}`, originX, row * cellH + 16);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rigs, doc, mode, moveSpeed, zoom, timeScale, useBlend, useBob, showAnchors]);

  // Frame strip for one actor.
  useEffect(() => {
    if (!rigs || !stripRef.current) return;
    const rig = rigs.find((r) => r.target === stripTarget) ?? rigs[0];
    if (!rig) return;
    const canvas = stripRef.current;
    const ctx = canvas.getContext("2d")!;
    const scale = 2;
    const cellW = rig.frames[0].width * scale + 8;
    const cellH = rig.frames[0].height * scale + 26;
    canvas.width = Math.min(12, rig.frames.length) * cellW;
    canvas.height = Math.ceil(rig.frames.length / 12) * cellH;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#171b17";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    rig.frames.forEach((frame, index) => {
      const col = index % 12;
      const row = Math.floor(index / 12);
      const x = col * cellW + 4;
      const y = row * cellH + 4;
      // checker
      for (let cy = 0; cy < frame.height * scale; cy += 8) {
        for (let cx = 0; cx < frame.width * scale; cx += 8) {
          ctx.fillStyle = ((cx + cy) / 8) % 2 ? "#242a24" : "#1d221d";
          ctx.fillRect(x + cx, y + cy, 8, 8);
        }
      }
      ctx.drawImage(frame, x, y, frame.width * scale, frame.height * scale);
      ctx.fillStyle = "#9aa48f";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(index), x + (frame.width * scale) / 2, y + frame.height * scale + 14);
    });
  }, [rigs, stripTarget]);

  if (error) return <main style={{ padding: 24, fontFamily: "monospace", color: "#dcd8c8", background: "#14181a", minHeight: "100vh" }}>{error}</main>;
  if (!doc || !rigs) return <main style={{ padding: 24, fontFamily: "monospace", color: "#dcd8c8", background: "#14181a", minHeight: "100vh" }}>Loading art document…</main>;

  const control: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6 };
  return (
    <main style={{ padding: 16, fontFamily: "monospace", background: "#14181a", color: "#dcd8c8", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 16, marginBottom: 4 }}>HOLDOUT animation lab</h1>
      <p style={{ fontSize: 11, color: "#8b937f", marginBottom: 12 }}>
        document {doc.generatedAt} · {Object.keys(doc.assets).length} assets · runtime-identical playback (sampleClip + EntityAnimator + computeMotionPose)
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, marginBottom: 12 }}>
        <label style={control}>state
          <select value={mode} onChange={(e) => setMode(e.target.value as PlayMode)}>
            <option value="cycle">cycle (all)</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={control}>speed {moveSpeed}px/s
          <input type="range" min={40} max={340} value={moveSpeed} onChange={(e) => setMoveSpeed(Number(e.target.value))} />
        </label>
        <label style={control}>zoom {zoom}x
          <input type="range" min={1} max={4} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <label style={control}>time {timeScale}x
          <input type="range" min={0.1} max={2} step={0.1} value={timeScale} onChange={(e) => setTimeScale(Number(e.target.value))} />
        </label>
        <label style={control}><input type="checkbox" checked={useBlend} onChange={(e) => setUseBlend(e.target.checked)} />keyframe blend</label>
        <label style={control}><input type="checkbox" checked={useBob} onChange={(e) => setUseBob(e.target.checked)} />procedural bob</label>
        <label style={control}><input type="checkbox" checked={showAnchors} onChange={(e) => setShowAnchors(e.target.checked)} />anchors</label>
      </div>
      <div style={{ overflowX: "auto" }}><canvas ref={canvasRef} style={{ imageRendering: "pixelated", border: "1px solid #2c332c" }} /></div>
      <h2 style={{ fontSize: 13, margin: "16px 0 6px" }}>
        frame strip{" "}
        <select value={stripTarget} onChange={(e) => setStripTarget(e.target.value)}>
          {rigs.map((rig) => <option key={rig.target} value={rig.target}>{rig.label}</option>)}
        </select>
      </h2>
      <div style={{ overflowX: "auto" }}><canvas ref={stripRef} style={{ imageRendering: "pixelated", border: "1px solid #2c332c" }} /></div>
      <TimelineSection doc={doc} />
      <CatalogSection doc={doc} />
    </main>
  );
}

/**
 * Deterministic timeline: one clip sampled at even time steps in a single
 * strip, with a baseline ruler — verifies foot planting and pose spacing
 * from a single still image.
 */
function TimelineSection({ doc }: { doc: PreviewDocument }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [target, setTarget] = useState("player");
  const [state, setState] = useState<EntityAnimationState>("walk");
  useEffect(() => {
    if (!canvasRef.current) return;
    const profile = doc.animations[target];
    const asset = profile ? doc.assets[profile.spriteId] : undefined;
    if (!profile || !asset) return;
    const clip = profile.clips[state] ?? profile.clips.idle;
    const totalMs = clipTotalMs(clip, 500);
    const samples = 14;
    const scale = 2.4;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const cellW = Math.round(asset.width * scale) + 6;
    const cellH = Math.round(asset.height * scale) + 30;
    canvas.width = samples * cellW;
    canvas.height = cellH;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#171b17";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const frames = asset.frames.map((frame) => frameToCanvas(frame, asset.width, asset.height));
    for (let index = 0; index < samples; index++) {
      const t = (index / samples) * totalMs;
      const sample = sampleClip(clip, state, t, 0, false);
      const x = index * cellW + 3;
      const y = 4;
      const w = asset.width * scale;
      const h = asset.height * scale;
      if (sample.blendFrame !== undefined && sample.blendAlpha < 1) {
        ctx.globalAlpha = 1 - sample.blendAlpha;
        ctx.drawImage(frames[Math.min(frames.length - 1, sample.blendFrame)], x, y, w, h);
        ctx.globalAlpha = sample.blendAlpha;
        ctx.drawImage(frames[Math.min(frames.length - 1, sample.frame)], x, y, w, h);
        ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(frames[Math.min(frames.length - 1, sample.frame)], x, y, w, h);
      }
      // baseline ruler at the sprite's anchor bottom (2px padding in-source)
      ctx.strokeStyle = "rgba(120,220,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(x, y + h - 2 * scale);
      ctx.lineTo(x + w, y + h - 2 * scale);
      ctx.stroke();
      ctx.fillStyle = "#8b937f";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(t)}ms f${sample.frame}`, x + w / 2, y + h + 12);
    }
  }, [doc, target, state]);
  return (
    <section>
      <h2 style={{ fontSize: 13, margin: "16px 0 6px" }}>
        timeline{" "}
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {Object.keys(doc.animations).map((id) => <option key={id} value={id}>{id.replace(/^mob:/, "")}</option>)}
        </select>{" "}
        <select value={state} onChange={(e) => setState(e.target.value as EntityAnimationState)}>
          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </h2>
      <div style={{ overflowX: "auto" }}><canvas ref={canvasRef} style={{ imageRendering: "pixelated", border: "1px solid #2c332c" }} /></div>
    </section>
  );
}

/** Static art catalog: every non-actor asset at pixel scale for art QA. */
function CatalogSection({ doc }: { doc: PreviewDocument }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [group, setGroup] = useState("item:");
  useEffect(() => {
    if (!canvasRef.current) return;
    const entries = Object.entries(doc.assets).filter(([id]) => id.startsWith(group));
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const columns = 12;
    const scale = group === "terrain:" ? 1.5 : 2;
    const maxW = Math.max(...entries.map(([, a]) => a.width), 1) * scale;
    const maxH = Math.max(...entries.map(([, a]) => a.height), 1) * scale;
    const cellW = maxW + 10;
    const cellH = maxH + 26;
    canvas.width = columns * cellW;
    canvas.height = Math.ceil(entries.length / columns) * cellH;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#171b17";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    entries.forEach(([id, asset], index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = col * cellW + 5;
      const y = row * cellH + 5;
      for (let cy = 0; cy < maxH; cy += 8) {
        for (let cx = 0; cx < maxW; cx += 8) {
          ctx.fillStyle = ((cx + cy) / 8) % 2 ? "#242a24" : "#1d221d";
          ctx.fillRect(x + cx, y + cy, Math.min(8, maxW - cx), Math.min(8, maxH - cy));
        }
      }
      const frame = frameToCanvas(asset.frames[0], asset.width, asset.height);
      ctx.drawImage(frame, x + (maxW - asset.width * scale) / 2, y + maxH - asset.height * scale, asset.width * scale, asset.height * scale);
      ctx.fillStyle = "#8b937f";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(id.slice(group.length).slice(0, 14), x + maxW / 2, y + maxH + 12);
    });
  }, [doc, group]);
  return (
    <section>
      <h2 style={{ fontSize: 13, margin: "16px 0 6px" }}>
        catalog{" "}
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="item:">items</option>
          <option value="block:">blocks</option>
          <option value="resource:">resources</option>
          <option value="terrain:">terrain</option>
        </select>
      </h2>
      <div style={{ overflowX: "auto" }}><canvas ref={canvasRef} style={{ imageRendering: "pixelated", border: "1px solid #2c332c" }} /></div>
    </section>
  );
}
