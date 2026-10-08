"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping, Box3, DirectionalLight, Group, HemisphereLight,
  Mesh, Object3D, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace,
  Texture, Vector3, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type Props = { onLoaded?: () => void };

function disposeModel(object: Object3D) {
  const textures = new Set<Texture>();
  const materials = new Set<import("three").Material>();
  object.traverse(node => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
}

function Still({ message }: { message: string }) {
  return <div style={{ position: "absolute", inset: 0, background: "#090807" }}>
    <img src="/images/burger-studio/cinema/hero.webp" alt="Burger mit geschmolzenem Cheddar auf dem Grill" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <p role="status" style={{ position: "absolute", bottom: 20, left: 20, right: 20, margin: 0, padding: "12px 16px", color: "#f4e5ce", background: "#090807df", fontSize: 12, lineHeight: 1.5 }}>{message}</p>
  </div>;
}

export default function BurgerCinemaModel({ onLoaded }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef<OrbitControls | null>(null);
  const callback = useRef(onLoaded);
  callback.current = onLoaded;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let alive = true;
    let frame = 0;
    let visible = true;
    let loaded = false;
    let model: Object3D | null = null;
    let renderer: WebGLRenderer | null = null;
    let orbit: OrbitControls | null = null;
    let environment: ReturnType<PMREMGenerator["fromScene"]> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let timeout = 0;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scene = new Scene();
    const camera = new PerspectiveCamera(36, 1, 0.1, 40);
    camera.position.set(0, 0.9, 5.2);
    let previousTime = 0;

    function stop() { if (frame) window.cancelAnimationFrame(frame); frame = 0; previousTime = 0; }
    function animate(time: number) {
      frame = 0;
      if (!alive || !visible || document.hidden || !renderer || !orbit) return;
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.1) : 1 / 60;
      previousTime = time;
      orbit.update(delta);
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    }
    function resume() { if (alive && visible && !document.hidden && !frame) frame = window.requestAnimationFrame(animate); }
    function visibility() { if (document.hidden) stop(); else resume(); }
    function motionChanged() { if (orbit) orbit.autoRotate = !motion.matches && loaded; }
    function interacted() { if (orbit) orbit.autoRotate = false; }
    function contextLost(event: Event) { event.preventDefault(); fail(); }
    function teardown() {
      if (!alive) return;
      alive = false;
      stop();
      window.clearTimeout(timeout);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", motionChanged);
      renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      orbit?.removeEventListener("start", interacted);
      orbit?.dispose();
      controls.current = null;
      if (model) disposeModel(model);
      environment?.dispose();
      scene.clear();
      renderer?.dispose();
      renderer?.domElement.remove();
    }
    function fail() { if (!alive) return; teardown(); setFailed(true); }

    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      renderer.domElement.setAttribute("aria-label", "Burger aus verschiedenen Blickwinkeln");
      element.appendChild(renderer.domElement);
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      const room = new RoomEnvironment();
      const pmrem = new PMREMGenerator(renderer);
      try { environment = pmrem.fromScene(room, 0.04); }
      finally { pmrem.dispose(); room.dispose(); }
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.45;
      scene.add(new HemisphereLight("#fff1da", "#3b2614", 0.25));
      const key = new DirectionalLight("#fff1da", 1.5); key.position.set(-3, 4, 5); scene.add(key);
      const rim = new DirectionalLight("#ffaf67", 1); rim.position.set(3, 1, -3); scene.add(rim);
      const fill = new DirectionalLight("#ffffff", 0.5); fill.position.set(1, 3, 1); scene.add(fill);
      orbit = new OrbitControls(camera, renderer.domElement);
      controls.current = orbit;
      orbit.enablePan = false;
      orbit.minDistance = 3.8; orbit.maxDistance = 7;
      orbit.minPolarAngle = Math.PI * 0.22; orbit.maxPolarAngle = Math.PI * 0.54;
      orbit.enableDamping = true; orbit.dampingFactor = 0.07;
      orbit.autoRotate = false; orbit.autoRotateSpeed = 0.45;
      orbit.update(); orbit.saveState();
      orbit.addEventListener("start", interacted);
      const resize = () => {
        if (!alive || !renderer) return;
        const width = Math.max(element.clientWidth, 1);
        const height = Math.max(element.clientHeight, 1);
        camera.aspect = width / height; camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        resume();
      };
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element); resize();
      intersectionObserver = new IntersectionObserver(entries => {
        visible = entries[0]?.isIntersecting ?? false;
        if (visible) resume(); else stop();
      });
      intersectionObserver.observe(element);
      document.addEventListener("visibilitychange", visibility);
      motion.addEventListener("change", motionChanged);
      timeout = window.setTimeout(fail, 20000);
      new GLTFLoader().load("/models/cinema/burger.glb", gltf => {
        if (!alive) { disposeModel(gltf.scene); return; }
        try {
          model = gltf.scene;
          const bounds = new Box3().setFromObject(model);
          const dimensions = bounds.getSize(new Vector3());
          const center = bounds.getCenter(new Vector3());
          const scale = 2.8 / Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001);
          const root = new Group(); root.add(model);
          root.scale.setScalar(scale); root.position.copy(center).multiplyScalar(-scale);
          scene.add(root);
          renderer!.render(scene, camera);
          loaded = true;
          window.clearTimeout(timeout);
          motionChanged();
          setReady(true);
          callback.current?.();
          resume();
        } catch { fail(); }
      }, undefined, fail);
      resume();
    } catch { fail(); }
    return teardown;
  }, []);

  function rotate(direction: number) {
    const orbit = controls.current;
    if (!orbit) return;
    orbit.autoRotate = false;
    const position = orbit.object.position.clone().sub(orbit.target);
    position.applyAxisAngle(new Vector3(0, 1, 0), direction * Math.PI / 6);
    orbit.object.position.copy(position.add(orbit.target));
    orbit.update();
  }
  function reset() { const orbit = controls.current; if (orbit) { orbit.autoRotate = false; orbit.reset(); } }
  const buttonStyle = { border: "1px solid #c9ab783b", borderRadius: 999, background: "#11100ed9", color: "#e9dcc8", minHeight: 44, padding: "10px 16px", fontSize: 12, cursor: "pointer" };

  return <section aria-label="Interaktive 360-Grad-Ansicht eines Burgers" style={{ width: "100%", position: "relative", background: "radial-gradient(ellipse at 50% 55%, #21160e, #080807 70%)", color: "#e9dcc8", border: "1px solid #c9ab7824", overflow: "hidden", borderRadius: 16 }}>
    <div style={{ height: "clamp(270px, 51vh, 560px)", position: "relative" }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {!ready && !failed && <div role="status" style={{ position: "absolute", zIndex: 2, inset: 0, display: "grid", placeItems: "center", fontSize: 12, letterSpacing: ".08em", pointerEvents: "none" }}>Dein Burger wird ins Licht gesetzt …</div>}
      {failed && <Still message="Die 360°-Ansicht ist auf diesem Gerät gerade nicht verfügbar. Du kannst deinen Burger trotzdem weiter kreieren." />}
    </div>
    <div style={{ padding: "14px 20px 18px", position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", background: "#080807" }}>
      <div><span style={{ display: "block", color: "#c7a77c", fontSize: 10, letterSpacing: ".18em", marginBottom: 6 }}>360° / BURGER ATELIER</span><p style={{ margin: 0, fontSize: 12, color: "#aca396" }}>Mit dem Finger oder der Maus drehen. Zum Vergrößern zoomen.</p></div>
      <div role="group" aria-label="Kamerasteuerung" style={{ display: "flex", gap: 8 }}>
        <button type="button" style={buttonStyle} onClick={() => rotate(-1)} disabled={!ready || failed} aria-label="Burger nach links drehen">←</button>
        <button type="button" style={buttonStyle} onClick={reset} disabled={!ready || failed}>Ansicht zurücksetzen</button>
        <button type="button" style={buttonStyle} onClick={() => rotate(1)} disabled={!ready || failed} aria-label="Burger nach rechts drehen">→</button>
      </div>
    </div>
  </section>;
}
