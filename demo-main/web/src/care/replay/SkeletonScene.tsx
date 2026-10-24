/**
 * The r3f stick figure. The current frame is a float in `frameRef`, advanced inside useFrame at
 * fps × speed, so playback never re-renders React; the page only hears about whole-frame changes.
 */
import { Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { LineSegments2 } from 'three-stdlib';
import type { ReplayFile } from '../../types';
import { readToken, useChartTheme } from '../../ui/chartTheme';
import { JOINT, boneSegments, sceneOrigin, scenePoints, type Vec3 } from './replayMath';

export interface SkeletonSceneProps {
  replay: ReplayFile;
  /** Overlaid at 35% opacity ("Both": the healthy side). */
  ghost?: ReplayFile | null;
  /** Joint indices of the moving arm, drawn larger. */
  activeJoints: number[];
  ghostActiveJoints?: number[];
  /** Per-frame: true when the frame is within ±3 frames of a warning (tinted --danger). */
  warnMask: boolean[];
  frameRef: MutableRefObject<number>;
  frameCount: number;
  playing: boolean;
  speed: number;
  /** Called when the whole-frame index changes during playback. */
  onFrame: (frame: number) => void;
  /** Called when playback reaches the last frame. */
  onEnd: () => void;
  label: string;
}

const JOINT_RADIUS = 0.026;
const ACTIVE_SCALE = 1.35;
const NOSE_RADIUS = 0.045;
const GHOST_OPACITY = 0.35;

interface Palette {
  joint: string;
  bone: string;
  danger: string;
  ghost: string;
  grid: string;
  background: string;
}

function usePalette(): Palette {
  const t = useChartTheme();
  return useMemo(
    () => ({ joint: t.primary, bone: t.muted, danger: t.danger, ghost: t.info, grid: t.grid, background: readToken('surface-2') }),
    [t],
  );
}

export default function SkeletonScene(props: SkeletonSceneProps) {
  const palette = usePalette();
  const origin = useMemo(() => sceneOrigin(props.replay), [props.replay]);
  const ghostOrigin = useMemo(() => (props.ghost ? sceneOrigin(props.ghost) : null), [props.ghost]);
  const floorY = useMemo(() => {
    const pts = scenePoints(props.replay.frames[0], origin);
    return Math.min(pts[JOINT.left_ankle][1], pts[JOINT.right_ankle][1]) - 0.03;
  }, [props.replay, origin]);

  return (
    <Canvas camera={{ position: [0, 0.3, 2.4], fov: 40 }} dpr={[1, 2]} aria-label={props.label} role="img">
      <color attach="background" args={[palette.background]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[1.5, 2.5, 2]} intensity={1.4} />
      <gridHelper args={[3, 12, palette.grid, palette.grid]} position={[0, floorY, 0]} />
      <Player {...props} />
      <Figure
        replay={props.replay}
        origin={origin}
        frameRef={props.frameRef}
        activeJoints={props.activeJoints}
        warnMask={props.warnMask}
        jointColor={palette.joint}
        boneColor={palette.bone}
        dangerColor={palette.danger}
        opacity={1}
      />
      {props.ghost && ghostOrigin && (
        <Figure
          replay={props.ghost}
          origin={ghostOrigin}
          frameRef={props.frameRef}
          activeJoints={props.ghostActiveJoints ?? []}
          jointColor={palette.ghost}
          boneColor={palette.ghost}
          dangerColor={palette.ghost}
          opacity={GHOST_OPACITY}
        />
      )}
      <OrbitControls enablePan={false} target={[0, 0.25, 0]} minDistance={1} maxDistance={5} />
    </Canvas>
  );
}

/** Advances frameRef while playing. */
function Player({ frameRef, frameCount, playing, speed, replay, onFrame, onEnd }: SkeletonSceneProps) {
  const last = useRef(-1);
  const live = useRef({ playing, speed, onFrame, onEnd });
  live.current = { playing, speed, onFrame, onEnd };

  useFrame((_, delta) => {
    const l = live.current;
    if (l.playing) {
      const next = frameRef.current + Math.min(delta, 0.1) * replay.fps * l.speed;
      if (next >= frameCount - 1) {
        frameRef.current = frameCount - 1;
        l.onEnd();
      } else frameRef.current = next;
    }
    const i = Math.floor(frameRef.current);
    if (i !== last.current) {
      last.current = i;
      if (l.playing) l.onFrame(i);
    }
  });
  return null;
}

interface FigureProps {
  replay: ReplayFile;
  origin: Vec3;
  frameRef: MutableRefObject<number>;
  activeJoints: number[];
  warnMask?: boolean[];
  jointColor: string;
  boneColor: string;
  dangerColor: string;
  opacity: number;
}

function Figure({ replay, origin, frameRef, activeJoints, warnMask, jointColor, boneColor, dangerColor, opacity }: FigureProps) {
  const joints = useRef<THREE.InstancedMesh>(null);
  const nose = useRef<THREE.Mesh>(null);
  const bones = useRef<LineSegments2>(null);
  const drawn = useRef({ frame: -1, warn: null as boolean | null });
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => ({ joint: new THREE.Color(), bone: new THREE.Color(), danger: new THREE.Color() }), []);
  const initial = useMemo(() => boneSegments(scenePoints(replay.frames[0], origin)), [replay, origin]);
  const active = useMemo(() => new Set(activeJoints), [activeJoints]);
  const transparent = opacity < 1;

  useEffect(() => {
    colors.joint.set(jointColor);
    colors.bone.set(boneColor);
    colors.danger.set(dangerColor);
    drawn.current = { frame: -1, warn: null };
  }, [colors, jointColor, boneColor, dangerColor, replay, origin, active]);

  useFrame(() => {
    const n = replay.frames.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor(frameRef.current)));
    const warn = !!warnMask?.[i];
    const d = drawn.current;
    if (d.frame === i && d.warn === warn) return;

    if (d.frame !== i) {
      const pts = scenePoints(replay.frames[i], origin);
      const mesh = joints.current;
      if (mesh) {
        for (let j = 1; j < pts.length - 1; j++) {
          tmp.position.set(pts[j][0], pts[j][1], pts[j][2]);
          tmp.scale.setScalar(active.has(j) ? ACTIVE_SCALE : 1);
          tmp.updateMatrix();
          mesh.setMatrixAt(j - 1, tmp.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      nose.current?.position.set(pts[JOINT.nose][0], pts[JOINT.nose][1], pts[JOINT.nose][2]);
      bones.current?.geometry.setPositions(boneSegments(pts).flat());
    }
    if (d.warn !== warn) {
      const jc = warn ? colors.danger : colors.joint;
      const mat = joints.current?.material as THREE.MeshStandardMaterial | undefined;
      mat?.color.copy(jc);
      (nose.current?.material as THREE.MeshStandardMaterial | undefined)?.color.copy(jc);
      bones.current?.material.color.copy(warn ? colors.danger : colors.bone);
    }
    drawn.current = { frame: i, warn };
  });

  return (
    <group>
      <instancedMesh ref={joints} args={[undefined, undefined, 12]} frustumCulled={false}>
        <sphereGeometry args={[JOINT_RADIUS, 16, 12]} />
        <meshStandardMaterial color={jointColor} transparent={transparent} opacity={opacity} depthWrite={!transparent} roughness={0.5} />
      </instancedMesh>
      <mesh ref={nose} frustumCulled={false}>
        <sphereGeometry args={[NOSE_RADIUS, 20, 16]} />
        <meshStandardMaterial color={jointColor} transparent={transparent} opacity={opacity} depthWrite={!transparent} roughness={0.5} />
      </mesh>
      <Line
        ref={bones}
        points={initial}
        segments
        color={boneColor}
        lineWidth={transparent ? 3 : 4}
        transparent={transparent}
        opacity={opacity}
        depthWrite={!transparent}
        frustumCulled={false}
      />
    </group>
  );
}
