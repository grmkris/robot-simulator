"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import { RobotMesh } from "./RobotMesh";
import { CameraRig } from "./CameraRig";
import { useArenaStore } from "@/lib/store";

const ARENA_RADIUS = 10;

function ArenaFloor() {
  return (
    <group>
      {/* Main arena platform */}
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.05, 0]}
      >
        <cylinderGeometry args={[ARENA_RADIUS, ARENA_RADIUS, 0.1, 64]} />
        <meshStandardMaterial
          color="#1a1a2e"
          metalness={0.3}
          roughness={0.7}
        />
      </mesh>

      {/* Arena ring edge glow */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
      >
        <ringGeometry args={[ARENA_RADIUS - 0.15, ARENA_RADIUS, 64]} />
        <meshStandardMaterial
          color="#ff4444"
          emissive="#ff4444"
          emissiveIntensity={0.8}
          transparent
          opacity={0.7}
        />
      </mesh>

      {/* Center circle */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
      >
        <ringGeometry args={[0.9, 1.0, 32]} />
        <meshStandardMaterial
          color="#444488"
          emissive="#444488"
          emissiveIntensity={0.3}
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Grid for depth perception */}
      <Grid
        position={[0, 0.02, 0]}
        args={[30, 30]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#333355"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#444477"
        fadeDistance={20}
        fadeStrength={1}
        infiniteGrid={false}
      />
    </group>
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[10, 15, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <pointLight position={[0, 10, 0]} intensity={0.5} color="#6666ff" />
    </>
  );
}

function SceneContent() {
  const robots = useArenaStore((s) => s.robots);

  return (
    <>
      <Lights />
      <ArenaFloor />
      <CameraRig />
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={3}
        maxDistance={30}
      />

      {robots && (
        <>
          <RobotMesh
            state={robots[0]}
            color="#2266ff"
            emissiveColor="#4488ff"
          />
          <RobotMesh
            state={robots[1]}
            color="#ff4422"
            emissiveColor="#ff6644"
          />
        </>
      )}
    </>
  );
}

export function Arena3D() {
  return (
    <div className="w-full h-full">
      <Canvas
        shadows
        camera={{ position: [0, 12, 16], fov: 50 }}
        style={{ background: "#0a0a1a" }}
      >
        <SceneContent />
      </Canvas>
    </div>
  );
}
