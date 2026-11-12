import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { fieldPixelRatio, fieldPointCount } from "./field-support";

/**
 * The studio floor's particle field (spec 0010, AC-6; design.md recipe 7.7), a point cloud of
 * horizontal dashes that reshapes from a beam to a ring to a wave as the giant words go by.
 * This module is the only importer of `three` and is itself loaded dynamically, only when the
 * section is within a viewport of coming on screen and the browser can afford it.
 *
 * It draws only while the section is on screen, and under reduced motion draws one still frame
 * of the beam and nothing else. `mountField` returns a dispose function that releases the
 * geometry, the material and the renderer (and its WebGL context).
 */

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Snaps to 1/14 steps so the dashes sit in rows. */
const snap = (v: number) => Math.round(v * 14) / 14;

type Shape = () => [number, number, number];

const beam: Shape = () => {
  const y = snap(rand(-3, 3));
  const r = 0.2 + Math.pow((y + 3) / 6, 3) * 2.4;
  const t = rand(0, TAU);
  return [Math.cos(t) * r, y, Math.sin(t) * r];
};
const ring: Shape = () => {
  const u = rand(0, TAU);
  const v = rand(0, TAU);
  const k = 2.2 + 0.35 * Math.cos(v);
  return [k * Math.cos(u), snap(k * Math.sin(u)), 0.35 * Math.sin(v)];
};
const wave: Shape = () => {
  const x = rand(-5, 5);
  const z = rand(-3, 3);
  return [x, snap(Math.sin(x * 0.9) * 0.4 + Math.cos(z * 1.3) * 0.3 - 1.5), z];
};

function positions(count: number, shape: Shape): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) out.set(shape(), i * 3);
  return out;
}

const VERTEX = `attribute vec3 aB; attribute vec3 aC; attribute float aRand;
uniform float uStage, uTime, uSize, uPR; varying float vDepth;
void main(){
  vec3 p = uStage < 1.0 ? mix(position, aB, smoothstep(0.,1.,uStage)) : mix(aB, aC, smoothstep(0.,1.,uStage-1.));
  p.y += sin(uTime*0.6 + aRand*6.2831)*0.03;
  vec4 mv = modelViewMatrix*vec4(p,1.);
  gl_Position = projectionMatrix*mv;
  gl_PointSize = uSize*uPR/(-mv.z);
  vDepth = clamp((p.z+2.5)/5.,0.,1.);
}`;

const FRAGMENT = `uniform vec3 uC1, uC2; varying float vDepth;
void main(){
  vec2 uv = gl_PointCoord - .5;
  if (abs(uv.y) > .14 || abs(uv.x) > .46) discard;
  gl_FragColor = vec4(mix(uC2, uC1, vDepth), .85);
}`;

/** A colour token from the page's CSS, so no colour value is written in this file. */
const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Starts the field on `canvas`. `section` is the studio section (the field renders while it is on
 * screen) and `words` the giant word block whose scroll drives the shape. Returns the dispose
 * function, or null when the browser refused a WebGL context (the CSS glow stays).
 */
export function mountField(options: {
  readonly canvas: HTMLCanvasElement;
  readonly section: HTMLElement;
  readonly words: HTMLElement;
  readonly reduced: boolean;
}): (() => void) | null {
  const { canvas, section, words, reduced } = options;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }
  const pixelRatio = fieldPixelRatio(window.devicePixelRatio);
  renderer.setPixelRatio(pixelRatio);
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.z = 9;

  const count = fieldPointCount(window.innerWidth);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions(count, beam), 3));
  geometry.setAttribute("aB", new BufferAttribute(positions(count, ring), 3));
  geometry.setAttribute("aC", new BufferAttribute(positions(count, wave), 3));
  geometry.setAttribute(
    "aRand",
    new BufferAttribute(Float32Array.from({ length: count }, Math.random), 1),
  );
  const uniforms = {
    uStage: { value: 0 },
    uTime: { value: 0 },
    uSize: { value: 70 },
    uPR: { value: pixelRatio },
    uC1: { value: new Color(token("--color-field-1", "skyblue")) },
    uC2: { value: new Color(token("--color-field-2", "navy")) },
  };
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  scene.add(new Points(geometry, material));

  let frames = 0;
  const draw = () => {
    renderer.render(scene, camera);
    frames += 1;
    canvas.dataset.fieldFrames = String(frames);
  };
  let width = 0;
  let height = 0;
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0 || (w === width && h === height)) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (reduced) draw();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  canvas.dataset.fieldPoints = String(count);

  const teardown: (() => void)[] = [];
  if (reduced) {
    // One still frame of the beam (drawn again only if the canvas is resized, which clears it):
    // no ticker, no scroll triggers.
    if (frames === 0) draw();
    canvas.dataset.field = "static";
  } else {
    let active = false;
    const tick = (time: number) => {
      if (!active) return;
      uniforms.uTime.value = time;
      draw();
    };
    gsap.ticker.add(tick);
    teardown.push(() => gsap.ticker.remove(tick));
    const visible = ScrollTrigger.create({
      trigger: section,
      start: "top bottom",
      end: "bottom top",
      onToggle: (self) => (active = self.isActive),
    });
    const morph = gsap.to(uniforms.uStage, {
      value: 2,
      ease: "none",
      scrollTrigger: { trigger: words, start: "top top", end: "bottom bottom", scrub: 1 },
    });
    teardown.push(() => {
      visible.kill();
      morph.scrollTrigger?.kill();
      morph.kill();
    });
    canvas.dataset.field = "ready";
  }

  return () => {
    teardown.forEach((fn) => fn());
    observer.disconnect();
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.dataset.field = "disposed";
  };
}
