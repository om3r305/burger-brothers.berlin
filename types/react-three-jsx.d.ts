// types/react-three-jsx.d.ts
import "@react-three/fiber";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      // Işıklar
      ambientLight: any;
      directionalLight: any;

      // Temel 3D node'lar
      group: any;
      mesh: any;

      // Geometriler
      sphereGeometry: any;
      boxGeometry: any;
      cylinderGeometry: any;

      // Drei kontrolleri vb. eklemek istersen:
      // OrbitControls: any;
      // Environment: any;
    }
  }
}
export {};
