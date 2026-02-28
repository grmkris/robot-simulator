"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ViewerRobotState } from "@/lib/types";

// Robot dimensions (must match server constants)
const CHASSIS = { x: 0.5, y: 0.3, z: 0.5 };
const ARM = { x: 0.12, y: 0.12, z: 0.7 };

interface RobotMeshProps {
  state: ViewerRobotState;
  color: string;
  emissiveColor: string;
}

export function RobotMesh({ state, color, emissiveColor }: RobotMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const targetQuat = useRef(new THREE.Quaternion());
  const targetPos = useRef(new THREE.Vector3());

  useFrame((_frameState, delta) => {
    if (!groupRef.current) return;

    // Smooth position interpolation
    const [px, py, pz] = state.position;
    targetPos.current.set(px, py, pz);
    groupRef.current.position.lerp(
      targetPos.current,
      Math.min(1, delta * 25)
    );

    // Smooth rotation interpolation
    targetQuat.current.set(
      state.rotation[0],
      state.rotation[1],
      state.rotation[2],
      state.rotation[3]
    );
    groupRef.current.quaternion.slerp(
      targetQuat.current,
      Math.min(1, delta * 25)
    );

    // Arm angles (rotate around Y axis at the joint pivot)
    if (leftArmRef.current) {
      leftArmRef.current.rotation.y = THREE.MathUtils.lerp(
        leftArmRef.current.rotation.y,
        state.armAngles[0],
        Math.min(1, delta * 25)
      );
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.y = THREE.MathUtils.lerp(
        rightArmRef.current.rotation.y,
        state.armAngles[1],
        Math.min(1, delta * 25)
      );
    }
  });

  return (
    <group ref={groupRef}>
      {/* Chassis */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[CHASSIS.x * 2, CHASSIS.y * 2, CHASSIS.z * 2]} />
        <meshStandardMaterial
          color={color}
          emissive={emissiveColor}
          emissiveIntensity={0.4}
          metalness={0.7}
          roughness={0.2}
        />
      </mesh>

      {/* Eyes (front indicators) — bigger, brighter */}
      <mesh position={[0.18, 0.15, CHASSIS.z - 0.02]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={1.0}
        />
      </mesh>
      <mesh position={[-0.18, 0.15, CHASSIS.z - 0.02]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={1.0}
        />
      </mesh>

      {/* Left Arm — pivots at chassis left edge */}
      <group
        ref={leftArmRef}
        position={[-(CHASSIS.x + ARM.x), 0, 0]}
      >
        <mesh
          castShadow
          position={[0, 0, ARM.z / 2]}
        >
          <boxGeometry args={[ARM.x * 2, ARM.y * 2, ARM.z * 2]} />
          <meshStandardMaterial
            color={color}
            emissive={emissiveColor}
            emissiveIntensity={0.2}
            metalness={0.8}
            roughness={0.3}
          />
        </mesh>
        {/* Fist — big glowing sphere */}
        <mesh position={[0, 0, ARM.z + 0.1]}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshStandardMaterial
            color={emissiveColor}
            emissive={emissiveColor}
            emissiveIntensity={0.8}
          />
        </mesh>
      </group>

      {/* Right Arm — pivots at chassis right edge */}
      <group
        ref={rightArmRef}
        position={[CHASSIS.x + ARM.x, 0, 0]}
      >
        <mesh
          castShadow
          position={[0, 0, ARM.z / 2]}
        >
          <boxGeometry args={[ARM.x * 2, ARM.y * 2, ARM.z * 2]} />
          <meshStandardMaterial
            color={color}
            emissive={emissiveColor}
            emissiveIntensity={0.2}
            metalness={0.8}
            roughness={0.3}
          />
        </mesh>
        {/* Fist — big glowing sphere */}
        <mesh position={[0, 0, ARM.z + 0.1]}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshStandardMaterial
            color={emissiveColor}
            emissive={emissiveColor}
            emissiveIntensity={0.8}
          />
        </mesh>
      </group>
    </group>
  );
}
