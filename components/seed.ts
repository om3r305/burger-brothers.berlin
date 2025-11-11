// components/seed.ts
import type { MenuItem } from "@/lib/types";

export const seed: MenuItem[] = [
  {id:"b1",name:"Smoky Classic",desc:"Karamellisierte Zwiebel, Cheddar, Gurke, Haussoße",price:11,imageUrl:"https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=1200&auto=format&fit=crop",videoUrl:"https://cdn.coverr.co/videos/coverr-flipping-burger-4554/1080p.mp4",tags:["beliebt"],category:"burger",removable:["Zwiebel","Gurke","Soße"],addable:[{id:"kaese",name:"Extra Käse",price:1},{id:"jalapeno",name:"Jalapeño",price:1}]},
  {id:"b2",name:"Black Pepper Melt",desc:"Doppelkäse, Pfeffer, Pilze",price:12,imageUrl:"https://images.unsplash.com/photo-1606756790138-261d2b21cd4a?q=80&w=1200&auto=format&fit=crop",videoUrl:"https://cdn.coverr.co/videos/coverr-bbq-grill-2999/1080p.mp4",category:"burger",removable:["Pilze","Soße"],addable:[{id:"bacon",name:"Bacon",price:2}]},
  {id:"e1",name:"Rustic Fries",desc:"Rosmarin & Meersalz",price:4,imageUrl:"https://images.unsplash.com/photo-1585238342028-4bbc0d6e09b0?q=80&w=1200&auto=format&fit=crop",category:"extra"},
  {id:"d1",name:"Hauslimonade",desc:"Zitrone-Minze",price:3,imageUrl:"https://images.unsplash.com/photo-1497534446932-c925b458314e?q=80&w=1200&auto=format&fit=crop",category:"drink"},
  {id:"s1",name:"Smoky BBQ",desc:"Zuckerfrei, intensiv",price:1.5,imageUrl:"https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?q=80&w=1200&auto=format&fit=crop",category:"sauce"},
  {id:"v1",name:"Green Glow Veggie",desc:"Grill-Gemüse, Veggie-Patty, Avocado",price:12,imageUrl:"https://images.unsplash.com/photo-1607014220463-576eda4babaab?q=80&w=1200&auto=format&fit=crop",videoUrl:"https://cdn.coverr.co/videos/coverr-flaming-vegetables-5778/1080p.mp4",category:"vegan",removable:["Zwiebel"],addable:[{id:"vegancheese",name:"Veganer Käse",price:1}]}
];
