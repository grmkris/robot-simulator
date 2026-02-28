"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { RobotMesh } from "./RobotMesh";
import { ArenaFloor } from "./ArenaFloor";
import { Lights } from "./Lights";
import { ProjectileMesh } from "./ProjectileMesh";

interface ViewerRobotFrame {
  position: [number, number, number];
  rotation: [number, number, number, number];
  armAngles: [number, number];
}

interface ViewerProjectileFrame {
  position: [number, number, number];
  ownerId: 0 | 1;
}

interface ViewerFrame {
  tick: number;
  time: number;
  robots: [ViewerRobotFrame, ViewerRobotFrame];
  projectiles?: ViewerProjectileFrame[];
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
        minDistance={3}
        maxDistance={35}
      />

      {frame && (
        <>
          <RobotMesh
            position={frame.robots[0].position}
            rotation={frame.robots[0].rotation}
            armAngles={frame.robots[0].armAngles}
            color="#2266ff"
            emissiveColor="#4488ff"
          />
          <RobotMesh
            position={frame.robots[1].position}
            rotation={frame.robots[1].rotation}
            armAngles={frame.robots[1].armAngles}
            color="#ff4422"
            emissiveColor="#ff6644"
          />

          {/* Render projectiles in replay */}
          {frame.projectiles?.map((proj, i) => (
            <ProjectileMesh
              key={`proj-${i}`}
              position={proj.position}
              ownerId={proj.ownerId}
            />
          ))}
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
        camera={{ position: [0, 14, 18], fov: 50 }}
        style={{ background: "#0a0a1a" }}
      >
        <SceneContent frame={frame} />
      </Canvas>
    </div>
  );
}
