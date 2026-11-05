/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Camera, Download, Pause, Play, Rotate3d } from 'lucide-react';
import { RadialBladeDesign } from '../utils/bladeGeometry';
import { generateBinarySTL } from '../utils/exportGeometry';

interface RowGeometry {
  bladeCount: number;
  heightMm: number;
  meanRadiusMm: number;
  chordMm: number;
}

interface Rotor3DVisualizerProps {
  radialDesign: RadialBladeDesign;
  stageName?: string;
  rpm?: number;
  rotationDirection?: 1 | -1;
  statorGeometry?: RowGeometry;
}

export const Rotor3DVisualizer: React.FC<Rotor3DVisualizerProps> = ({
  radialDesign,
  stageName = 'Etapa 1',
  rpm = 0,
  rotationDirection = 1,
  statorGeometry,
}) => {
  const [wireframe, setWireframe] = useState(false);
  const [showRotor, setShowRotor] = useState(true);
  const [showStator, setShowStator] = useState(true);
  const [showHub, setShowHub] = useState(true);
  const [showShaft, setShowShaft] = useState(true);
  const [rotating, setRotating] = useState(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rotorGroupRef = useRef<THREE.Group | null>(null);
  const statorGroupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationRef = useRef<number | null>(null);
  const rotatingRef = useRef(rotating);
  const rpmRef = useRef(rpm);
  const rotationDirectionRef = useRef(rotationDirection);
  useEffect(() => { rotatingRef.current = rotating; }, [rotating]);
  useEffect(() => { rpmRef.current = rpm; }, [rpm]);
  useEffect(() => { rotationDirectionRef.current = rotationDirection; }, [rotationDirection]);

  const rotorGeometry = useMemo(() => {
    const chord = Math.max(2, radialDesign.mid.params.c_ax);
    const height = Math.max(2, radialDesign.hb_mm);
    const thickness = Math.max(1, chord * 0.03);
    const geometry = new THREE.BoxGeometry(height, thickness, chord);
    // X is radial, Y is circumferential thickness, Z is axial.
    geometry.translate(radialDesign.Rm_mm, 0, chord / 2);
    return geometry;
  }, [radialDesign]);

  const statorGeometryMesh = useMemo(() => {
    if (!statorGeometry) return null;
    const chord = Math.max(2, statorGeometry.chordMm);
    const height = Math.max(2, statorGeometry.heightMm);
    const geometry = new THREE.BoxGeometry(height, Math.max(1, chord * 0.03), chord);
    geometry.translate(statorGeometry.meanRadiusMm, 0, chord / 2);
    return geometry;
  }, [statorGeometry]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f3f7);
    sceneRef.current = scene;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(42, width / height, 1, 5000);
    const extent = Math.max(radialDesign.R_tip_mm, 100);
    camera.position.set(extent * 3, -extent * 3.8, extent * 3.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.replaceChildren(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x718096, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(extent * 2, -extent, extent * 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x93c5fd, 1.3);
    fill.position.set(-extent, extent * 2, -extent);
    scene.add(fill);

    const grid = new THREE.GridHelper(extent * 3.2, 32, 0xb7c3d1, 0xdbe3ec);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -Math.max(radialDesign.mid.params.c_ax, 40) * 1.3;
    scene.add(grid);

    const rotorGroup = new THREE.Group();
    const statorGroup = new THREE.Group();
    scene.add(rotorGroup, statorGroup);
    rotorGroupRef.current = rotorGroup;
    statorGroupRef.current = statorGroup;

    let lastTime = performance.now();
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (rotatingRef.current && rotorGroupRef.current) {
        rotorGroupRef.current.rotation.z += rotationDirectionRef.current * (2 * Math.PI * rpmRef.current / 60) * 0.025 * dt;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      controls.dispose();
      renderer.dispose();
      scene.clear();
    };
  }, [radialDesign.R_tip_mm, radialDesign.Rm_mm, radialDesign.mid.params.c_ax]);

  useEffect(() => {
    const rotorGroup = rotorGroupRef.current;
    const statorGroup = statorGroupRef.current;
    if (!rotorGroup || !statorGroup) return;
    rotorGroup.clear();
    statorGroup.clear();

    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: wireframe ? 0x0e7490 : 0xb9c8d8,
      metalness: 0.18,
      roughness: 0.52,
      side: THREE.DoubleSide,
      wireframe,
    });
    const statorMaterial = new THREE.MeshStandardMaterial({
      color: wireframe ? 0x0f766e : 0x58a99d,
      metalness: 0.12,
      roughness: 0.56,
      side: THREE.DoubleSide,
      wireframe,
    });

    if (showRotor) {
      const count = radialDesign.bladeCount_Z;
      const rotor = new THREE.InstancedMesh(rotorGeometry, bladeMaterial, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        dummy.rotation.set(0, 0, i * 2 * Math.PI / count);
        dummy.updateMatrix();
        rotor.setMatrixAt(i, dummy.matrix);
      }
      rotor.instanceMatrix.needsUpdate = true;
      rotorGroup.add(rotor);
    }

    if (showStator && statorGeometry && statorGeometryMesh) {
      const stator = new THREE.InstancedMesh(statorGeometryMesh, statorMaterial, statorGeometry.bladeCount);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < statorGeometry.bladeCount; i++) {
        dummy.rotation.set(0, 0, i * 2 * Math.PI / statorGeometry.bladeCount);
        dummy.updateMatrix();
        stator.setMatrixAt(i, dummy.matrix);
      }
      stator.instanceMatrix.needsUpdate = true;
      statorGroup.position.z = -Math.max(statorGeometry.chordMm, 2) * 1.3;
      statorGroup.add(stator);
    }

    if (showHub) {
      const hubRadius = radialDesign.R_hub_mm;
      const length = Math.max(radialDesign.mid.params.c_ax * 1.5, 5);
      const geometry = new THREE.CylinderGeometry(hubRadius, hubRadius, length, 64, 1);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, radialDesign.mid.params.c_ax / 2);
      rotorGroup.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x75869a, metalness: 0.28, roughness: 0.58, wireframe })));
    }
    if (showShaft) {
      const shaftRadius = Math.max(2, radialDesign.R_hub_mm * 0.36);
      const shaftLength = Math.max(radialDesign.mid.params.c_ax * 4.5, 20);
      const geometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 32, 1);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, radialDesign.mid.params.c_ax / 2);
      rotorGroup.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x53667d, metalness: 0.32, roughness: 0.5, wireframe })));
    }

    return () => {
      rotorGroup.clear();
      statorGroup.clear();
      bladeMaterial.dispose();
      statorMaterial.dispose();
    };
  }, [radialDesign, rotorGeometry, statorGeometry, statorGeometryMesh, showRotor, showStator, showHub, showShaft, wireframe]);

  const setView = (view: 'iso' | 'axial' | 'side') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const extent = Math.max(radialDesign.R_tip_mm, 100);
    if (view === 'iso') camera.position.set(extent * 3, -extent * 3.8, extent * 3.2);
    else if (view === 'axial') camera.position.set(0, 0, extent * 5);
    else camera.position.set(extent * 5, -extent * 0.5, extent * 0.6);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  const handleExport = (fullRotor: boolean) => {
    const geometry = rotorGeometry;
    const positions = geometry.getAttribute('position')?.array as Float32Array | undefined;
    const indices = geometry.getIndex()?.array as Uint32Array | Uint16Array | undefined;
    if (!positions) return;
    const blob = generateBinarySTL(positions, indices, fullRotor ? radialDesign.bladeCount_Z : 1);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fullRotor ? `${stageName.replace(/\s+/g, '_')}_rotor_extrusion.stl` : `${stageName.replace(/\s+/g, '_')}_alabe_recto.stl`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-lg flex flex-col min-w-0">
      <header className="bg-white px-4 sm:px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-lg bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-800"><Rotate3d className="w-4 h-4" /></span><div><h3 className="text-sm font-semibold text-slate-900">Geometría de etapa <span className="ml-1 text-[10px] font-mono bg-cyan-50 text-cyan-800 px-2 py-0.5 rounded border border-cyan-200">{stageName}</span></h3><p className="text-xs text-slate-600">{statorGeometry ? `Estator: ${statorGeometry.bladeCount} · Rotor: ${radialDesign.bladeCount_Z} álabes` : `Rotor contrarrotativo: ${radialDesign.bladeCount_Z} álabes`}</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><button onClick={() => setWireframe((value) => !value)} className="px-2.5 py-1.5 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50">{wireframe ? 'Sólido' : 'Aristas'}</button><button onClick={() => handleExport(true)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> STL rotor</button><button onClick={() => handleExport(false)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> STL álabe</button></div>
      </header>
      <div className="relative w-full h-[min(68vh,580px)] min-h-[380px] bg-[#f0f3f7] select-none">
        <div ref={mountRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5 bg-white/95 border border-slate-300 rounded-lg p-1.5 shadow-md"><Camera className="w-3.5 h-3.5 text-slate-600 ml-1" /><button onClick={() => setView('iso')} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs">Isométrica</button><button onClick={() => setView('axial')} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs">Axial</button><button onClick={() => setView('side')} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs">Lateral</button></div>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/95 border border-slate-300 rounded-xl px-3 sm:px-4 py-2.5 flex flex-wrap justify-center items-center gap-3 shadow-lg max-w-[96%] text-xs text-slate-700">
          <button onClick={() => setRotating((value) => !value)} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-semibold ${rotating ? 'bg-emerald-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-800'}`}>{rotating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}{rotating ? 'Pausar' : 'Girar rotor'}</button>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={showStator} disabled={!statorGeometry} onChange={(event) => setShowStator(event.target.checked)} /> Estator {statorGeometry ? `(${statorGeometry.bladeCount})` : '(no aplica)'}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={showRotor} onChange={(event) => setShowRotor(event.target.checked)} /> Rotor ({radialDesign.bladeCount_Z})</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={showHub} onChange={(event) => setShowHub(event.target.checked)} /> Buje</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={showShaft} onChange={(event) => setShowShaft(event.target.checked)} /> Eje</label>
        </div>
        <p className="absolute top-14 left-3 max-w-[240px] rounded bg-white/90 px-2 py-1 text-[10px] leading-relaxed text-slate-600 shadow">Álabes rectos representados como placas extruidas, sin perfil ni torsión aerodinámica.</p>
      </div>
    </div>
  );
};
