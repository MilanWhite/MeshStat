import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

function ExplodableModel({
	url,
	autoRotate = true,
	rotateSpeed = 0.2,
}: {
	url: string;
	autoRotate?: boolean;
	rotateSpeed?: number; // radians/sec
}) {
	const { scene, animations } = useGLTF(url);

	// Wrap the model so we can rotate around its own center
	const pivot = useRef<THREE.Group>(null);
	const mixer = useRef<THREE.AnimationMixer | null>(null);
	const action = useRef<THREE.AnimationAction | null>(null);
	const [hovered, setHovered] = useState(false);

	// Center the scene at (0,0,0) so rotation is around the geometry center
	const centeredScene = useMemo(() => {
		const s = scene.clone(true);

		const box = new THREE.Box3().setFromObject(s);
		const center = box.getCenter(new THREE.Vector3());
		s.position.sub(center);

		return s;
	}, [scene]);

	useEffect(() => {
		mixer.current = new THREE.AnimationMixer(centeredScene);

		const clip = animations?.[0];
		if (clip) {
			action.current = mixer.current.clipAction(clip);
			action.current.clampWhenFinished = true;
			action.current.loop = THREE.LoopOnce;
			action.current.enabled = true;
			action.current.play();
			action.current.paused = true; // scrub manually
			action.current.time = 0;
		}

		return () => {
			mixer.current?.stopAllAction();
			mixer.current = null;
			action.current = null;
		};
	}, [centeredScene, animations]);

	useFrame((_, delta) => {
		if (autoRotate && pivot.current) {
			pivot.current.rotation.y += rotateSpeed * delta;
		}

		if (!mixer.current || !action.current) return;

		const duration = action.current.getClip().duration;
		const target = hovered ? duration : 0;

		action.current.time = THREE.MathUtils.damp(
			action.current.time,
			target,
			2.5,
			delta
		);

		mixer.current.update(0);
	});

	return (
		<group
			ref={pivot}
			onPointerOver={() => setHovered(true)}
			onPointerOut={() => setHovered(false)}
		>
			<primitive object={centeredScene} />
		</group>
	);
}

export default function ExplodeOnHoverViewer() {
	return (
		<div className="mt-10" style={{ width: "100%", height: 500 }}>
			<Canvas camera={{ position: [0, 0, 3], fov: 50 }}>
				<ambientLight intensity={1} />
				<directionalLight position={[3, 3, 3]} intensity={1} />

				<ExplodableModel url="../../src/assets/source/kinghacksassembly.glb" />

				<OrbitControls
					enablePan={false}
					enableZoom={false} // no zoom
					enableRotate={true}
					minDistance={0.3} // redundant when zoom disabled, but safe
					maxDistance={0.3}
				/>
			</Canvas>
		</div>
	);
}
