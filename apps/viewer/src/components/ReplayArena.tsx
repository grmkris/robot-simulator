"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import { ReplayRobotMesh } from "./ReplayRobotMesh";

const ARENA_RADIUS = 5;

interface ViewerRobotFrame {
  position: [number, number, number];
  rotation: [number, number, number, number];
  armAngles: [number, number];
}

interface ViewerFrame {
  tick: number;
  time: number;
  robots: [ViewerRobotFrame, ViewerRobotFrame];
}

function ArenaFloor() {
  return (
    <group>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.05, 0]}
      >
        <cylinderGeometry args={[ARENA_RADIUS, ARENA_RADIUS, 0.2, 64]} />
        <meshStandardMaterial
          color="#1a1a2e"
          metalness={0.4}
          roughness={0.5}
        />
      </mesh>

      {/* Edge glow */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
      >
        <ringGeometry args={[ARENA_RADIUS - 0.2, ARENA_RADIUS, 64]} />
        <meshStandardMaterial
          color="#ff2222"
          emissive="#ff2222"
          emissiveIntensity={1.2}
          transparent
          opacity={0.8}
        />
      </mesh>

      {/* Warning ring */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
      >
        <ringGeometry args={[ARENA_RADIUS * 0.7 - 0.05, ARENA_RADIUS * 0.7 + 0.05, 64]} />
        <meshStandardMaterial
          color="#ff8800"
          emissive="#ff8800"
          emissiveIntensity={0.4}
          transparent
          opacity={0.4}
        />
      </mesh>

      {/* Center circle */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
      >
        <ringGeometry args={[0.4, 0.5, 32]} />
        <meshStandardMaterial
          color="#6666cc"
          emissive="#6666cc"
          emissiveIntensity={0.5}
          transparent
          opacity={0.6}
        />
      </mesh>

      <Grid
        position={[0, 0.02, 0]}
        args={[15, 15]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#333355"
        sectionSize={ARENA_RADIUS}
        sectionThickness={1}
        sectionColor="#444477"
        fadeDistance={12}
        fadeStrength={1}
        infiniteGrid={false}
      />
    </group>
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[5, 12, 8]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={30}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <pointLight position={[0, 8, 0]} intensity={0.8} color="#4466ff" />
      <pointLight position={[-4, 5, -4]} intensity={0.3} color="#2266ff" />
      <pointLight position={[4, 5, 4]} intensity={0.3} color="#ff4422" />
    </>
  );
}

interface ReplayArenaProps {
  frame: ViewerFrame | null;
}

function SceneContent({ frame }: ReplayArenaProps) {
  return (
    <>
      <Lights />
      <ArenaFloor />
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={2}
        maxDistance={20}
      />

      {frame && (
        <>
          <ReplayRobotMesh
            position={frame.robots[0].position}
            rotation={frame.robots[0].rotation}
            armAngles={frame.robots[0].armAngles}
            color="#2266ff"
            emissiveColor="#4488ff"
          />
          <ReplayRobotMesh
            position={frame.robots[1].position}
            rotation={frame.robots[1].rotation}
            armAngles={frame.robots[1].armAngles}
            color="#ff4422"
            emissiveColor="#ff6644"
          />
        </>
      )}
    </>
  );
}

export function ReplayArena({ frame }: ReplayArenaProps) {
  return (
    <div className="w-full h-full">
      <Canvas
        shadows
        camera={{ position: [0, 8, 10], fov: 50 }}
        style={{ background: "#0a0a1a" }}
      >
        <SceneContent frame={frame} />
      </Canvas>
    </div>
  );
}
