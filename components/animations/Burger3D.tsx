"use client";
import { motion } from "framer-motion";
export default function Burger3D({ src, alt, size=220 }:{src:string; alt:string; size?:number}){
  return (
    <motion.div
      whileHover={{ rotateY: 360 }}
      transition={{ duration: 1.4, ease: "easeInOut" }}
      className="mx-auto"
      style={{ width:size, height:size, perspective: 800 }}
    >
      <img src={src} alt={alt} style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:16 }} />
    </motion.div>
  );
}
