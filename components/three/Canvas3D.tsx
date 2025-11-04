// components/three/Canvas3D.tsx
"use client";

import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";

type Props = { children: React.ReactNode };

export default function Canvas3D({ children }: Props) {
  return (
    <div className="relative h-[420px] w-full rounded-xl bg-black/40 ring-1 ring-stone-700/60">
      <Canvas
        camera={{ position: [0.5, 0.4, 1.4], fov: 40 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          {/* Lights */}
          <ambientLight intensity={0.6} />
          <directionalLight
            position={[2, 3, 2]}
            intensity={1.2}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />

          {/* Image-based lighting */}
          <Environment preset="warehouse" />

          {/* 3D content */}
          {children}

          {/* Controls */}
          <OrbitControls
            enablePan={false}
            enableDamping
            dampingFactor={0.05}
            maxDistance={2.2}
            minDistance={0.8}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
