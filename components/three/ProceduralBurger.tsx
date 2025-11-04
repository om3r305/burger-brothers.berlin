"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { GroupProps } from "@react-three/fiber";

export default function ProceduralBurger(props: GroupProps) {
  // Malzemeler (tek seferlik oluştur)
  const bunMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xc58f55,       // üst/alt ekmek
        roughness: 0.7,
        metalness: 0.1,
      }),
    []
  );

  const pattyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x4a2e2a,       // köfte
        roughness: 0.9,
        metalness: 0.05,
      }),
    []
  );

  const cheeseMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xffc64d,       // cheddar
        roughness: 0.6,
        metalness: 0.2,
        emissive: 0x331a00,
        emissiveIntensity: 0.05,
      }),
    []
  );

  return (
    <group {...props}>
      {/* Üst ekmek (sphereGeometry'yi yassılayıp ölçekliyoruz) */}
      <mesh material={bunMat} position={[0, 0.32, 0]} scale={[1, 0.55, 1]} castShadow receiveShadow>
        <sphereGeometry args={[0.5, 48, 32]} />
      </mesh>

      {/* Peynir dilimi */}
      <mesh material={cheeseMat} position={[0, 0.1, 0]} rotation={[0, 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.02, 0.9]} />
      </mesh>

      {/* Köfte */}
      <mesh material={pattyMat} position={[0, -0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.18, 48]} />
      </mesh>

      {/* Alt ekmek */}
      <mesh material={bunMat} position={[0, -0.22, 0]} scale={[1, 0.4, 1]} castShadow receiveShadow>
        <sphereGeometry args={[0.5, 48, 32]} />
      </mesh>
    </group>
  );
}
