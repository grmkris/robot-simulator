"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { RobotMesh } from "./RobotMesh";
import { ArenaFloor } from "./ArenaFloor";
import { Lights } from "./Lights";
import { CameraRig } from "./CameraRig";
import { ProjectileMesh } from "./ProjectileMesh";
import { useArenaStore } from "@/lib/store";

function SceneContent() {
  const robots = useArenaStore((s) => s.robots);
  const projectiles = useArenaStore((s) => s.projectiles);

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
        maxDistance={35}
      />

      {robots && (
        <>
          <RobotMesh
            position={robots[0].position}
            rotation={robots[0].rotation}
            armAngles={robots[0].armAngles}
            color="#2266ff"
            emissiveColor="#4488ff"
          />
          <RobotMesh
            position={robots[1].position}
            rotation={robots[1].rotation}
            armAngles={robots[1].armAngles}
            color="#ff4422"
            emissiveColor="#ff6644"
          />
        </>
      )}

      {/* Render projectiles */}
      {projectiles.map((proj, i) => (
        <ProjectileMesh
          key={`proj-${i}`}
          position={proj.position}
          ownerId={proj.ownerId}
        />
      ))}
    </>
  );
}

export function Arena3D() {
  return (
    <div className="w-full h-full">
      <Canvas
        shadows
        camera={{ position: [0, 14, 18], fov: 50 }}
        style={{ background: "#0a0a1a" }}
      >
        <SceneContent />
      </Canvas>
    </div>
  );
}
