// app/showcase/page.tsx
"use client";
import Canvas3D from "@/components/three/Canvas3D";
import ProceduralBurger from "@/components/three/ProceduralBurger";

export default function Showcase() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Canvas3D>
        <ProceduralBurger position={[0, -0.1, 0]} />
      </Canvas3D>
    </main>
  );
}
