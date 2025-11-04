"use client";
import { motion } from "framer-motion";
export default function BottleOpen({ src, alt, size=180 }:{src:string; alt:string; size?:number}){
  return (
    <motion.div
      whileTap={{ rotate: -10, scale: 0.98 }}
      whileHover={{ y: -4 }}
      transition={{ type:"spring", stiffness: 220, damping: 18 }}
      className="mx-auto"
      style={{ width:size, height:size }}
    >
      <img src={src} alt={alt} style={{ width:"100%", height:"100%", objectFit:"contain" }} />
    </motion.div>
  );
}
