'use client';
import {useEffect,useRef,useState} from 'react';
import {Canvas,useFrame} from '@react-three/fiber';
import {Float} from '@react-three/drei';
import type{Group}from'three';
function Structure({reduced}:{reduced:boolean}){
 const ref=useRef<Group>(null);
 useFrame((s,delta)=>{if(!reduced&&ref.current){ref.current.rotation.y+=Math.min(delta,.08)*.1;ref.current.rotation.x=Math.sin(s.clock.elapsedTime*.24)*.07}});
 return <group ref={ref} rotation={[.2,-.65,.25]}>
  {[0,1,2].map(i=><Float key={i} speed={reduced?0:1} rotationIntensity={0} floatIntensity={reduced?0:.13}>
   <mesh position={[0,(i-1)*.7,0]} rotation={[0,0,(i-1)*.17]}><boxGeometry args={[2.8,.18,2.8]}/><meshPhysicalMaterial color={i===1?'#28d6c3':'#142b3b'} metalness={.82} roughness={.19} clearcoat={1}/></mesh>
   <mesh position={[0,(i-1)*.7,0]} rotation={[0,0,(i-1)*.17]}><boxGeometry args={[2.53,.2,2.53]}/><meshBasicMaterial color={i===1?'#50eedb':'#42778c'} wireframe transparent opacity={.22}/></mesh>
  </Float>)}
  <mesh><icosahedronGeometry args={[.68,1]}/><meshStandardMaterial color="#c0fff4" emissive="#0e776e" emissiveIntensity={.55} metalness={.73} roughness={.24} wireframe/></mesh>
 </group>;
}
export function HeroScene(){
 const[reduced,setReduced]=useState(true);const[ready,setReady]=useState(false);
 useEffect(()=>{const m=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(m.matches);update();m.addEventListener('change',update);setReady(true);return()=>m.removeEventListener('change',update)},[]);
 return <div className="scene-shell"><div className="scene-fallback" aria-hidden="true"><div className="fallback-layer one"/><div className="fallback-layer two"/><div className="fallback-layer three"/></div>
 {ready&&<Canvas dpr={[1,1.5]} camera={{position:[4,3.1,5.4],fov:39}} gl={{alpha:true,antialias:true,powerPreference:'low-power'}} fallback={<span className="sr-only">Decorative illustration</span>}><ambientLight intensity={1.1}/><directionalLight color="#87fff0" intensity={3} position={[2,4,4]}/><pointLight color="#2d69e7" position={[-3,-2,1]} intensity={24}/><Structure reduced={reduced}/></Canvas>}</div>;
}
