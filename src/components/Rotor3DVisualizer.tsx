/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Camera, Download, Hand, Pause, Play, Rotate3d, Scan, X } from 'lucide-react';
import { RadialBladeDesign } from '../utils/bladeGeometry';
import { generateBinarySTL } from '../utils/exportGeometry';
import { downloadBlob } from '../utils/download';

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

type CameraView = 'iso' | 'axial' | 'side';

/** Escala mínima de la escena [mm], para que un diseño degenerado no deje la cámara en el origen. */
const MIN_EXTENT_MM = 10;
/** Factor de rotación visual: el giro real a N rpm sería imperceptible como animación. */
const VISUAL_SPIN_FACTOR = 0.025;
const HINT_DURATION_MS = 1600;
const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** Posición de la cámara para cada vista, proporcional a la escala de la escena. */
function cameraOffsetFor(view: CameraView, extent: number): THREE.Vector3 {
  if (view === 'axial') return new THREE.Vector3(0, 0, extent * 5);
  if (view === 'side') return new THREE.Vector3(extent * 5, -extent * 0.5, extent * 0.6);
  return new THREE.Vector3(extent * 3, -extent * 3.8, extent * 3.2);
}

/** Libera la GPU de todas las mallas de un grupo y lo vacía. Las geometrías compartidas (memoizadas) no se tocan. */
function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.ownsGeometry === true) object.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  group.clear();
}

/** Lee un token de color del tema; si no está disponible devuelve el valor de reserva. */
function readThemeColor(token: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

/** Cabecera ASCII del STL (≤ 80 caracteres), sin tildes ni caracteres no imprimibles. */
function buildStlHeader(stageName: string): string {
  const ascii = stageName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
  return `Turbina 1D - ${ascii || 'Etapa'} - unidades: mm`.slice(0, 80);
}

/** Nombre de fichero seguro a partir del nombre de la etapa. */
function fileSlug(stageName: string): string {
  const slug = stageName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'etapa';
}

/**
 * Replica una geometría indexada `copies` veces girándola alrededor del eje Z (eje de la máquina)
 * y devuelve un único conjunto de posiciones e índices para exportar.
 */
function replicateAroundAxis(geometry: THREE.BufferGeometry, copies: number): { positions: Float32Array; indices: Uint32Array } {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const vertexCount = position.count;
  const baseIndices: ArrayLike<number> = index ? index.array : Array.from({ length: vertexCount }, (_, i) => i);
  const count = Math.max(1, Math.round(copies));
  const positions = new Float32Array(vertexCount * 3 * count);
  const indices = new Uint32Array(baseIndices.length * count);

  for (let copy = 0; copy < count; copy++) {
    const angle = (copy * 2 * Math.PI) / count;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const vertexOffset = copy * vertexCount;
    for (let v = 0; v < vertexCount; v++) {
      const x = position.getX(v);
      const y = position.getY(v);
      const target = (vertexOffset + v) * 3;
      positions[target] = x * cosA - y * sinA;
      positions[target + 1] = x * sinA + y * cosA;
      positions[target + 2] = position.getZ(v);
    }
    const indexOffset = copy * baseIndices.length;
    for (let i = 0; i < baseIndices.length; i++) indices[indexOffset + i] = baseIndices[i] + vertexOffset;
  }

  return { positions, indices };
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
  const [isCoarsePointer, setIsCoarsePointer] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COARSE_POINTER_QUERY).matches,
  );
  const [touchActive, setTouchActive] = useState(false);
  const [wheelHint, setWheelHint] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rotorGroupRef = useRef<THREE.Group | null>(null);
  const statorGroupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const requestRenderRef = useRef<() => void>(() => undefined);
  const framedExtentRef = useRef<number | null>(null);
  const extentRef = useRef(MIN_EXTENT_MM);
  const focusedRef = useRef(false);
  const hintTimerRef = useRef<number | null>(null);

  const rotatingRef = useRef(rotating);
  const rpmRef = useRef(rpm);
  const rotationDirectionRef = useRef(rotationDirection);
  useEffect(() => { rotatingRef.current = rotating; requestRenderRef.current(); }, [rotating]);
  useEffect(() => { rpmRef.current = rpm; }, [rpm]);
  useEffect(() => { rotationDirectionRef.current = rotationDirection; }, [rotationDirection]);

  const extent = Math.max(radialDesign.R_tip_mm, statorGeometry ? statorGeometry.meanRadiusMm + statorGeometry.heightMm / 2 : 0, MIN_EXTENT_MM);
  const axialChord = radialDesign.mid.params.c_ax;

  const rotorGeometry = useMemo(() => {
    const chord = Math.max(2, radialDesign.mid.params.c_ax);
    const height = Math.max(2, radialDesign.hb_mm);
    const thickness = Math.max(1, chord * 0.03);
    const geometry = new THREE.BoxGeometry(height, thickness, chord);
    // X es radial, Y es el espesor circunferencial y Z es axial.
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

  // Las geometrías memoizadas se liberan cuando se sustituyen o al desmontar.
  useEffect(() => () => rotorGeometry.dispose(), [rotorGeometry]);
  useEffect(() => () => statorGeometryMesh?.dispose(), [statorGeometryMesh]);

  // Detecta pantallas táctiles (y su cambio, p. ej. al conectar un ratón a una tableta).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(COARSE_POINTER_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsCoarsePointer(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  // Escena, cámara, renderer y controles: se crean una sola vez.
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(readThemeColor('--color-surface-muted', '#f1f4f8'));
    sceneRef.current = scene;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(42, width / height, 1, 5000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.style.display = 'block';
    renderer.domElement.setAttribute('role', 'img');
    container.replaceChildren(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.listenToKeyEvents(container);
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x718096, 2.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.3);
    scene.add(keyLight, fillLight);
    keyLightRef.current = keyLight;
    fillLightRef.current = fillLight;

    const rotorGroup = new THREE.Group();
    const statorGroup = new THREE.Group();
    scene.add(rotorGroup, statorGroup);
    rotorGroupRef.current = rotorGroup;
    statorGroupRef.current = statorGroup;

    // Render bajo demanda: solo se encadenan fotogramas mientras gira el rotor o dura la amortiguación.
    let frameId: number | null = null;
    let lastTime = performance.now();
    let isVisible = true;
    let pageVisible = document.visibilityState !== 'hidden';

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      let needsMore = false;
      if (rotatingRef.current) {
        rotorGroup.rotation.z += rotationDirectionRef.current * ((2 * Math.PI * rpmRef.current) / 60) * VISUAL_SPIN_FACTOR * dt;
        needsMore = true;
      }
      if (controls.update()) needsMore = true;
      renderer.render(scene, camera);
      frameId = needsMore && isVisible && pageVisible ? requestAnimationFrame(tick) : null;
    };

    const requestRender = () => {
      if (frameId !== null || !isVisible || !pageVisible) return;
      lastTime = performance.now();
      frameId = requestAnimationFrame(tick);
    };
    requestRenderRef.current = requestRender;
    controls.addEventListener('change', requestRender);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    const intersectionObserver = new IntersectionObserver((entries) => {
      isVisible = entries.some((entry) => entry.isIntersecting);
      if (isVisible) requestRender();
    });
    intersectionObserver.observe(container);

    const handleVisibility = () => {
      pageVisible = document.visibilityState !== 'hidden';
      if (pageVisible) requestRender();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
      requestRenderRef.current = () => undefined;
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      disposeGroup(rotorGroup);
      disposeGroup(statorGroup);
      if (gridRef.current) {
        gridRef.current.dispose();
        gridRef.current = null;
      }
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      rotorGroupRef.current = null;
      statorGroupRef.current = null;
      keyLightRef.current = null;
      fillLightRef.current = null;
      framedExtentRef.current = null;
    };
  }, []);

  const frameCamera = useCallback((view: CameraView = 'iso') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.copy(cameraOffsetFor(view, extentRef.current));
    controls.target.set(0, 0, 0);
    controls.update();
    requestRenderRef.current();
  }, []);

  // Escala de la escena: planos de recorte, límites de distancia, rejilla y luces proporcionales al tamaño.
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    extentRef.current = extent;

    camera.near = extent * 0.01;
    camera.far = extent * 50;
    camera.updateProjectionMatrix();
    controls.minDistance = extent * 0.3;
    controls.maxDistance = extent * 20;

    keyLightRef.current?.position.set(extent * 2, -extent, extent * 3);
    fillLightRef.current?.position.set(-extent, extent * 2, -extent);

    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.dispose();
    }
    const grid = new THREE.GridHelper(extent * 3.2, 32, 0xb7c3d1, 0xdbe3ec);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -Math.max(axialChord, extent * 0.1) * 1.3;
    scene.add(grid);
    gridRef.current = grid;

    // Encuadre automático solo la primera vez o si la escala cambia más de 2×; si no, se respeta la vista del usuario.
    const framed = framedExtentRef.current;
    if (framed === null || extent > framed * 2 || extent < framed / 2) {
      framedExtentRef.current = extent;
      frameCamera('iso');
    } else {
      requestRenderRef.current();
    }
  }, [extent, axialChord, frameCamera]);

  // Mallas: se reconstruyen al cambiar el diseño o las capas, liberando antes la GPU.
  useEffect(() => {
    const rotorGroup = rotorGroupRef.current;
    const statorGroup = statorGroupRef.current;
    if (!rotorGroup || !statorGroup) return;
    disposeGroup(rotorGroup);
    disposeGroup(statorGroup);

    if (showRotor) {
      const count = Math.max(1, Math.round(radialDesign.bladeCount_Z));
      const material = new THREE.MeshStandardMaterial({
        color: wireframe ? 0x0e7490 : 0xb9c8d8,
        metalness: 0.18,
        roughness: 0.52,
        side: THREE.DoubleSide,
        wireframe,
      });
      const rotor = new THREE.InstancedMesh(rotorGeometry, material, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        dummy.rotation.set(0, 0, (i * 2 * Math.PI) / count);
        dummy.updateMatrix();
        rotor.setMatrixAt(i, dummy.matrix);
      }
      rotor.instanceMatrix.needsUpdate = true;
      rotorGroup.add(rotor);
    }

    if (showStator && statorGeometry && statorGeometryMesh) {
      const count = Math.max(1, Math.round(statorGeometry.bladeCount));
      const material = new THREE.MeshStandardMaterial({
        color: wireframe ? 0x0f766e : 0x58a99d,
        metalness: 0.12,
        roughness: 0.56,
        side: THREE.DoubleSide,
        wireframe,
      });
      const stator = new THREE.InstancedMesh(statorGeometryMesh, material, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        dummy.rotation.set(0, 0, (i * 2 * Math.PI) / count);
        dummy.updateMatrix();
        stator.setMatrixAt(i, dummy.matrix);
      }
      stator.instanceMatrix.needsUpdate = true;
      statorGroup.position.z = -Math.max(statorGeometry.chordMm, 2) * 1.3;
      statorGroup.add(stator);
    }

    const chord = radialDesign.mid.params.c_ax;
    if (showHub) {
      const hubRadius = Math.max(1, radialDesign.R_hub_mm);
      const geometry = new THREE.CylinderGeometry(hubRadius, hubRadius, Math.max(chord * 1.5, 5), 64, 1);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, chord / 2);
      const hub = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x75869a, metalness: 0.28, roughness: 0.58, wireframe }));
      hub.userData.ownsGeometry = true;
      rotorGroup.add(hub);
    }
    if (showShaft) {
      const shaftRadius = Math.max(2, radialDesign.R_hub_mm * 0.36);
      const geometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, Math.max(chord * 4.5, 20), 32, 1);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, chord / 2);
      const shaft = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x53667d, metalness: 0.32, roughness: 0.5, wireframe }));
      shaft.userData.ownsGeometry = true;
      rotorGroup.add(shaft);
    }

    requestRenderRef.current();

    return () => {
      disposeGroup(rotorGroup);
      disposeGroup(statorGroup);
    };
  }, [radialDesign, rotorGeometry, statorGeometry, statorGeometryMesh, showRotor, showStator, showHub, showShaft, wireframe]);

  // Táctil: los controles solo se activan tras tocar el aviso, para no secuestrar el desplazamiento de la página.
  const interactionEnabled = !isCoarsePointer || touchActive;
  useEffect(() => {
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    if (!controls || !renderer) return;
    controls.enabled = interactionEnabled;
    renderer.domElement.style.touchAction = interactionEnabled ? 'none' : 'pan-y';
  }, [interactionEnabled]);

  useEffect(() => {
    if (!isCoarsePointer) setTouchActive(false);
  }, [isCoarsePointer]);

  useEffect(() => {
    rendererRef.current?.domElement.setAttribute(
      'aria-label',
      `Vista 3D de ${stageName}: rotor de ${radialDesign.bladeCount_Z} álabes${statorGeometry ? ` y estator de ${statorGeometry.bladeCount}` : ''}, radio de punta ${radialDesign.R_tip_mm.toFixed(0)} mm`,
    );
  }, [stageName, radialDesign.bladeCount_Z, radialDesign.R_tip_mm, statorGeometry]);

  // Rueda: solo hace zoom con Ctrl/Cmd (o gesto de pellizco del trackpad) o con el visor enfocado; si no, desplaza la página.
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || focusedRef.current) return;
      event.stopPropagation();
      setWheelHint(true);
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = window.setTimeout(() => setWheelHint(false), HINT_DURATION_MS);
    };
    container.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    return () => {
      container.removeEventListener('wheel', handleWheel, { capture: true });
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    };
  }, []);

  const handleExport = (fullRotor: boolean) => {
    setExportError(null);
    try {
      const copies = fullRotor ? radialDesign.bladeCount_Z : 1;
      const { positions, indices } = replicateAroundAxis(rotorGeometry, copies);
      const blob = generateBinarySTL(positions, indices, buildStlHeader(stageName));
      const slug = fileSlug(stageName);
      downloadBlob(blob, fullRotor ? `${slug}_rotor_placas.stl` : `${slug}_alabe_placa.stl`);
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : 'error desconocido';
      setExportError(`No se pudo generar el STL: ${detail}`);
    }
  };

  const segmentButton = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-label font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
      active ? 'bg-surface text-accent shadow-sm' : 'text-ink-3 hover:text-ink'
    }`;
  const viewButton =
    'px-2 py-1 rounded-md text-label text-ink-2 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent';

  return (
    <div className="bg-surface border border-line rounded-card shadow-card overflow-hidden flex flex-col min-w-0">
      <header className="px-4 sm:px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-lg bg-accent-soft flex items-center justify-center text-accent-strong">
            <Rotate3d className="w-4 h-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-title font-semibold text-ink flex flex-wrap items-center gap-2">
              Geometría de la etapa
              <span className="text-caption font-medium bg-accent-soft text-accent-strong px-2 py-0.5 rounded-md">{stageName}</span>
            </h3>
            <p className="text-caption text-ink-3">
              {statorGeometry
                ? `Estator: ${statorGeometry.bladeCount} álabes · Rotor: ${radialDesign.bladeCount_Z} álabes`
                : `Rotor contrarrotativo: ${radialDesign.bladeCount_Z} álabes`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Modo de representación" className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken p-1">
            <button type="button" aria-pressed={!wireframe} onClick={() => setWireframe(false)} className={segmentButton(!wireframe)}>
              Sólido
            </button>
            <button type="button" aria-pressed={wireframe} onClick={() => setWireframe(true)} className={segmentButton(wireframe)}>
              Aristas
            </button>
          </div>
          <button type="button" onClick={() => handleExport(true)} className="btn-secondary h-8 px-2.5 text-label" title="Descargar el rotor completo en STL binario (mm)">
            <Download className="w-3.5 h-3.5" aria-hidden="true" /> STL rotor
          </button>
          <button type="button" onClick={() => handleExport(false)} className="btn-secondary h-8 px-2.5 text-label" title="Descargar un álabe en STL binario (mm)">
            <Download className="w-3.5 h-3.5" aria-hidden="true" /> STL álabe
          </button>
        </div>
      </header>

      {exportError && (
        <div role="alert" className="flex items-start justify-between gap-3 border-b border-rose-200 bg-danger-soft px-4 py-2 text-label text-danger">
          <span>{exportError}</span>
          <button type="button" onClick={() => setExportError(null)} aria-label="Cerrar aviso" className="shrink-0 rounded p-0.5 hover:bg-surface focus-visible:outline-2 focus-visible:outline-danger">
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="relative w-full h-[45vh] min-h-[300px] sm:h-[min(68vh,580px)] sm:min-h-[380px] bg-surface-muted select-none">
        <div
          ref={mountRef}
          tabIndex={0}
          aria-label="Visor 3D. Arrastra para girar la vista; con el visor enfocado, la rueda acerca o aleja y las flechas desplazan."
          onFocus={() => { focusedRef.current = true; }}
          onBlur={() => { focusedRef.current = false; }}
          className={`w-full h-full block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${interactionEnabled ? 'cursor-grab active:cursor-grabbing' : ''}`}
        />

        {isCoarsePointer && !touchActive && (
          <button
            type="button"
            onClick={() => setTouchActive(true)}
            className="absolute inset-0 flex items-center justify-center bg-transparent"
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-surface/95 border border-line px-4 py-2 text-label font-semibold text-ink-2 shadow-card">
              <Hand className="w-4 h-4 text-accent" aria-hidden="true" /> Toca para interactuar
            </span>
          </button>
        )}

        <div className="absolute top-3 left-3 right-3 flex flex-wrap items-start gap-2 pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1 bg-surface/95 border border-line rounded-lg p-1 shadow-card">
            <Camera className="w-3.5 h-3.5 text-ink-3 mx-1" aria-hidden="true" />
            <button type="button" onClick={() => frameCamera('iso')} className={viewButton}>Isométrica</button>
            <button type="button" onClick={() => frameCamera('axial')} className={viewButton}>Axial</button>
            <button type="button" onClick={() => frameCamera('side')} className={viewButton}>Lateral</button>
            <button type="button" onClick={() => frameCamera('iso')} className={`${viewButton} inline-flex items-center gap-1`} title="Encuadrar la turbina completa">
              <Scan className="w-3.5 h-3.5" aria-hidden="true" /> Encuadrar
            </button>
          </div>
          {isCoarsePointer && touchActive && (
            <button
              type="button"
              onClick={() => setTouchActive(false)}
              className="pointer-events-auto ml-auto inline-flex items-center gap-1 rounded-lg bg-surface/95 border border-line px-2.5 py-1.5 text-label font-semibold text-ink-2 shadow-card"
            >
              Listo
            </button>
          )}
        </div>

        {wheelHint && (
          <p role="status" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface/95 border border-line px-3 py-1.5 text-label text-ink-2 shadow-card pointer-events-none">
            Ctrl + rueda para ampliar
          </p>
        )}

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-max max-w-[calc(100%-1.5rem)] bg-surface/95 border border-line rounded-xl px-3 py-2 flex flex-wrap justify-center items-center gap-x-3 gap-y-1.5 shadow-card text-label text-ink-2">
          <button
            type="button"
            aria-pressed={rotating}
            onClick={() => setRotating((value) => !value)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold focus-visible:outline-2 focus-visible:outline-accent ${
              rotating ? 'bg-ok text-white' : 'bg-surface-sunken text-ink-2 hover:bg-line'
            }`}
          >
            {rotating ? <Pause className="w-3.5 h-3.5" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />}
            {rotating ? 'Pausar' : 'Girar rotor'}
          </button>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-accent" checked={showStator} disabled={!statorGeometry} onChange={(event) => setShowStator(event.target.checked)} />
            Estator {statorGeometry ? `(${statorGeometry.bladeCount})` : '(no aplica)'}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-accent" checked={showRotor} onChange={(event) => setShowRotor(event.target.checked)} />
            Rotor ({radialDesign.bladeCount_Z})
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-accent" checked={showHub} onChange={(event) => setShowHub(event.target.checked)} />
            Buje
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-accent" checked={showShaft} onChange={(event) => setShowShaft(event.target.checked)} />
            Eje
          </label>
        </div>
      </div>
      <p className="px-4 sm:px-5 py-2 border-t border-line text-caption text-ink-3">
        Álabes rectos representados como placas extruidas, sin perfil ni torsión aerodinámica. El STL se exporta en milímetros.
      </p>
    </div>
  );
};
