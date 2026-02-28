"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { RobotMesh } from "./RobotMesh";
import { ArenaFloor } from "./ArenaFloor";
import { Lights } from "./Lights";

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
