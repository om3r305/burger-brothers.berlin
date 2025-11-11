// types/r3f-jsx.d.ts
import "@react-three/fiber";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      sphereGeometry: any;
      boxGeometry: any;
      cylinderGeometry: any;
      ambientLight: any;
      directionalLight: any;
      // istersen burada diğer drei/fiber etiketlerini de ekleyebiliriz
    }
  }
}
export {};
