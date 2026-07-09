"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * The launch-lock background: a single-pass WebGL shader inspired by Hack Club
 * Penumbra (penumbra.hackclub.com) — a raymarched field of soft, flowing
 * metaballs lit in Hack Club red, finished with a light CRT pass (gentle
 * scanlines, a whisper of chromatic aberration at the edges, and a vignette).
 *
 * Tuned LIGHT: the scene sits on a near-white background with red glow, so the
 * login card and its text stay crisp. Purely decorative — it gates nothing.
 *
 * Guards mirror HeroDoodleGlow: under prefers-reduced-motion, or when WebGL is
 * unavailable, it renders a static red/white gradient instead of animating.
 *
 * Lifecycle note: React 18 Strict Mode double-invokes effects in dev. The old
 * version called WEBGL_lose_context.loseContext() in cleanup, which poisoned
 * the shared canvas for the second mount (shaders then failed to compile on the
 * lost context, silently dropping to the fallback). We now create a FRESH
 * canvas element per effect run and swap it into the container, so each mount
 * gets a pristine GL context and cleanup can drop its own canvas without
 * affecting a re-mount.
 */

const VERT = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Single-pass raymarch of a small cluster of metaballs. The field is a smooth
// union of moving spheres (smin); we march it, shade with a cheap normal + key
// light, add a red glow that accumulates along the ray for the "bloom" feel,
// then a light CRT finish. Everything biases toward white so text stays legible.
const FRAG = `precision highp float;
uniform vec2 uResolution;
uniform float uTime;

const vec3 RED   = vec3(0.925, 0.216, 0.314); // #ec3750
const vec3 DEEP  = vec3(0.62, 0.09, 0.16);    // shadowed red
const vec3 PAPER = vec3(1.0, 0.98, 0.985);    // near-white background

// polynomial smooth-min (iq) — melts the spheres into one another.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdSphere(vec3 p, vec3 c, float r) { return length(p - c) - r; }

// The animated metaball field.
float map(vec3 p) {
  float t = uTime * 0.35;
  float d = 1e5;
  // A handful of orbiting blobs at slightly different speeds/radii.
  d = smin(d, sdSphere(p, vec3(sin(t) * 0.9, cos(t * 0.8) * 0.6, 0.0), 0.62), 0.55);
  d = smin(d, sdSphere(p, vec3(cos(t * 1.1) * 0.8, sin(t * 0.6) * 0.7, sin(t*0.5)*0.4), 0.5), 0.55);
  d = smin(d, sdSphere(p, vec3(sin(t * 0.7 + 2.0) * 1.0, cos(t * 1.3) * 0.5, 0.2), 0.45), 0.5);
  d = smin(d, sdSphere(p, vec3(cos(t * 0.9 + 1.0) * 0.6, sin(t * 1.1 + 3.0) * 0.9, -0.2), 0.4), 0.5);
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;

  // Camera looking down -z at the blob cluster (pulled back a little so the
  // whole cluster floats in frame).
  vec3 ro = vec3(0.0, 0.0, 4.0);
  vec3 rd = normalize(vec3(uv, -1.7));

  float tDist = 0.0;
  float glow = 0.0;
  bool hit = false;
  vec3 p = ro;

  // March. Accumulate proximity into glow so near-misses still bleed red
  // light (the cheap bloom substitute).
  for (int i = 0; i < 64; i++) {
    p = ro + rd * tDist;
    float d = map(p);
    glow += 0.015 / (0.01 + d * d); // brighter the closer the ray passes
    if (d < 0.001) { hit = true; break; }
    tDist += d;
    if (tDist > 8.0) break;
  }

  vec3 col = PAPER;

  if (hit) {
    vec3 n = calcNormal(p);
    vec3 lightDir = normalize(vec3(-0.6, 0.8, 0.5));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.0);
    // Shaded red surface: deep in shadow, bright red lit, white specular rim.
    vec3 surf = mix(DEEP, RED, diff);
    surf = mix(surf, vec3(1.0), rim * 0.6);
    col = mix(PAPER, surf, 0.9);
  }

  // Red glow bloom over the paper, kept gentle so the page stays light.
  col = mix(col, RED, clamp(glow * 0.10, 0.0, 0.55));

  // --- light CRT finish -------------------------------------------------
  vec2 sc = gl_FragCoord.xy / uResolution.xy;

  // Very faint scanlines — just enough texture to read as CRT, not banding.
  float scan = 0.985 + 0.015 * sin(gl_FragCoord.y * 1.6);
  col *= scan;

  // Whisper of chromatic aberration toward the edges (shift red vs blue).
  float ca = length(uv) * 0.004;
  col.r = mix(col.r, col.r + ca * 6.0, 0.5);

  // Airy finish: a gentle vignette that fades toward paper (not black) so the
  // corners stay light, plus a bright center wash so the card sits on white.
  float d = distance(sc, vec2(0.5));
  col = mix(col, PAPER, smoothstep(0.35, 0.95, d) * 0.55);   // lighten edges toward white
  col = mix(col, PAPER, smoothstep(0.5, 0.0, d) * 0.4);      // lighten center

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function LaunchShaderBg({ className = "" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Assume the animated path until we know we can't run it, so SSR and the
  // first client paint agree (the fallback only shows if WebGL/motion checks
  // fail after mount).
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFallback(true);
      return;
    }

    // Fresh canvas per effect run — a re-mount (Strict Mode) gets a pristine
    // context instead of inheriting one this effect's cleanup tore down.
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 h-full w-full";
    container.appendChild(canvas);

    const gl = (canvas.getContext("webgl", { antialias: true }) ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      canvas.remove();
      setFallback(true);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      canvas.remove();
      setFallback(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.remove();
      setFallback(true);
      return;
    }
    gl.useProgram(prog);

    // Full-screen triangle pair.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(prog, "uResolution");
    const uTime = gl.getUniformLocation(prog, "uTime");

    const resize = () => {
      // Cap DPR at 1.5 — the raymarch is the expensive part, and it's a soft
      // scene, so extra pixels buy little.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(window.innerWidth * dpr));
      const h = Math.max(1, Math.floor(window.innerHeight * dpr));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uResolution, w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const start = performance.now();
    const render = (now: number) => {
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      // Drop THIS run's context + canvas. A concurrent/next mount owns its own.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  // Static fallback: a soft red/white wash that echoes the shader palette.
  const fallbackStyle: React.CSSProperties = {
    background:
      "radial-gradient(120% 90% at 50% 0%, #ffffff 0%, #ffe9ec 45%, #f8c6ce 75%, #ec3750 130%)",
  };

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {fallback && <div className="absolute inset-0" style={fallbackStyle} />}
    </div>
  );
}
