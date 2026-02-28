"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const CHASSIS = { x: 0.5, y: 0.3, z: 0.5 };
const ARM = { x: 0.12, y: 0.12, z: 0.7 };

interface ReplayRobotMeshProps {
  position: [number, number, number];
  rotation: [number, number, number, number];
  armAngles: [number, number];
  color: string;
  emissiveColor: string;
}

export function ReplayRobotMesh({
  position,
  rotation,
  armAngles,
  color,
  emissiveColor,
}: ReplayRobotMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3());
  const targetQuat = useRef(new THREE.Quaternion());

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    // Smooth interpolation between frames
    targetPos.current.set(position[0], position[1], position[2]);
    groupRef.current.position.lerp(targetPos.current, Math.min(1, delta * 30));

    targetQuat.current.set(rotation[0], rotation[1], rotation[2], rotation[3]);
    groupRef.current.quaternion.slerp(targetQuat.current, Math.min(1, delta * 30));

    if (leftArmRef.current) {
      leftArmRef.current.rotation.y = THREE.MathUtils.lerp(
        leftArmRef.current.rotation.y,
        armAngles[0],
        Math.min(1, delta * 30)
      );
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.y = THREE.MathUtils.lerp(
        rightArmRef.current.rotation.y,
        armAngles[1],
        Math.min(1, delta * 30)
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

      {/* Eyes */}
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

      {/* Left Arm */}
      <group ref={leftArmRef} position={[-(CHASSIS.x + ARM.x), 0, 0]}>
        <mesh castShadow position={[0, 0, ARM.z / 2]}>
          <boxGeometry args={[ARM.x * 2, ARM.y * 2, ARM.z * 2]} />
          <meshStandardMaterial
            color={color}
            emissive={emissiveColor}
            emissiveIntensity={0.2}
            metalness={0.8}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[0, 0, ARM.z + 0.1]}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshStandardMaterial
            color={emissiveColor}
            emissive={emissiveColor}
            emissiveIntensity={0.8}
          />
        </mesh>
      </group>

      {/* Right Arm */}
      <group ref={rightArmRef} position={[CHASSIS.x + ARM.x, 0, 0]}>
        <mesh castShadow position={[0, 0, ARM.z / 2]}>
          <boxGeometry args={[ARM.x * 2, ARM.y * 2, ARM.z * 2]} />
          <meshStandardMaterial
            color={color}
            emissive={emissiveColor}
            emissiveIntensity={0.2}
            metalness={0.8}
            roughness={0.3}
          />
        </mesh>
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
