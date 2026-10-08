"use client";

import { Component, Suspense, createElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, Group, PMREMGenerator, Vector3 } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OrbitControls as OrbitControlsInstance } from "three-stdlib";

type Props = { onLoaded?: () => void };

class ViewerBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function StudioEnvironment({ onFailure }: { onFailure: () => void }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const room = new RoomEnvironment();
    const generator = new PMREMGenerator(gl);
    const environment = generator.fromScene(room, 0.04);
    const previous = scene.environment;
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.45;
    const contextLost = (event: Event) => { event.preventDefault(); onFailure(); };
    gl.domElement.addEventListener("webglcontextlost", contextLost);
    return () => {
      gl.domElement.removeEventListener("webglcontextlost", contextLost);
      scene.environment = previous;
      environment.dispose();
      generator.dispose();
      room.dispose();
    };
  }, [gl, scene, onFailure]);
  return null;
}

function Burger({ onLoaded }: { onLoaded: () => void }) {
  const { scene } = useGLTF("/models/cinema/burger.glb");
  const fitted = useMemo(() => {
    const object = scene.clone(true);
    const bounds = new Box3().setFromObject(object);
    const dimensions = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const scale = 2.8 / Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001);
    const root = new Group();
    root.add(object);
    root.position.copy(center).multiplyScalar(-scale);
    root.scale.setScalar(scale);
    return root;
  }, [scene]);
  useEffect(onLoaded, [onLoaded]);
  // Geometry, materials and textures belong to the GLTF cache and are shared.
  return createElement("primitive", { object: fitted, dispose: null });
}

function Still({ message }: { message: string }) {
  return <div style={{ position: "absolute", inset: 0, background: "#090807" }}>
    <img src="/images/burger-studio/cinema/hero.webp" alt="Burger mit geschmolzenem Cheddar auf dem Grill" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <p role="status" style={{ position: "absolute", bottom: 20, left: 20, right: 20, margin: 0, padding: "12px 16px", color: "#f4e5ce", background: "#090807df", fontSize: 12, lineHeight: 1.5 }}>{message}</p>
  </div>;
}

export default function BurgerCinemaModel({ onLoaded }: Props) {
  const controls = useRef<OrbitControlsInstance>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const loaded = useMemo(() => () => { setReady(true); onLoaded?.(); }, [onLoaded]);
  const fail = useMemo(() => () => setFailed(true), []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (ready || failed) return;
    const timeout = window.setTimeout(fail, 20000);
    return () => window.clearTimeout(timeout);
  }, [ready, failed, fail]);

  function rotate(direction: number) {
    setAutoRotate(false);
    const orbit = controls.current;
    if (!orbit) return;
    const position = orbit.object.position.clone().sub(orbit.target);
    position.applyAxisAngle(new Vector3(0, 1, 0), direction * Math.PI / 6);
    orbit.object.position.copy(position.add(orbit.target));
    orbit.update();
  }
  function reset() { controls.current?.reset(); setAutoRotate(false); }

  const buttonStyle = { border: "1px solid #c9ab783b", borderRadius: 999, background: "#11100ed9", color: "#e9dcc8", minHeight: 44, padding: "10px 16px", fontSize: 12, cursor: "pointer" };
  const fallback = <Still message="Die 360°-Ansicht ist auf diesem Gerät gerade nicht verfügbar. Du kannst deinen Burger trotzdem weiter kreieren." />;

  return <section aria-label="Interaktive 360-Grad-Ansicht eines Burgers" style={{ width: "100%", position: "relative", background: "radial-gradient(ellipse at 50% 55%, #21160e, #080807 70%)", color: "#e9dcc8", border: "1px solid #c9ab7824", overflow: "hidden", borderRadius: 16 }}>
    <div style={{ height: "clamp(270px, 51vh, 560px)", position: "relative" }}>
      {!ready && !failed && <div role="status" style={{ position: "absolute", zIndex: 2, inset: 0, display: "grid", placeItems: "center", fontSize: 12, letterSpacing: ".08em", pointerEvents: "none" }}>Dein Burger wird ins Licht gesetzt …</div>}
      {failed ? fallback : <ViewerBoundary onError={fail} fallback={fallback}>
        <Canvas camera={{ position: [0, 0.9, 5.2], fov: 36, near: 0.1, far: 40 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }} fallback={fallback}>
          {createElement("ambientLight", { intensity: 0.15 })}
          {createElement("directionalLight", { position: [-3, 4, 5], color: "#fff1da", intensity: 1.5 })}
          {createElement("directionalLight", { position: [3, 1, -3], color: "#ffaf67", intensity: 1.0 })}
          {createElement("directionalLight", { position: [1, 3, 1], color: "#ffffff", intensity: 0.5 })}
          <StudioEnvironment onFailure={fail} />
          <Suspense fallback={null}><Burger onLoaded={loaded} /></Suspense>
          <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={3.8} maxDistance={7} minPolarAngle={Math.PI * 0.22} maxPolarAngle={Math.PI * 0.54} enableDamping dampingFactor={0.07} autoRotate={autoRotate && !reducedMotion && ready} autoRotateSpeed={0.45} onStart={() => setAutoRotate(false)} />
        </Canvas>
      </ViewerBoundary>}
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
