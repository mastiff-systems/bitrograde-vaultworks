import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FallbackViewer } from './FallbackViewer.js';

interface Props {
  url: string;
  filename: string;
  downloadHref: string;
  onError: (err: Error) => void;
}

export function ModelViewer3D({ url, filename, downloadHref, onError }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = Math.max(mount.clientWidth, 320);
    const H = Math.max(mount.clientHeight, 240);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.add(new THREE.GridHelper(10, 20, 0x333355, 0x222244));

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.001, 100000);
    camera.position.set(0, 2, 5);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-5, -5, -3);
    scene.add(fillLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const fitCamera = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      obj.position.sub(center);
      const dist = size * 1.2;
      camera.position.set(0, size * 0.3, dist);
      camera.near = size * 0.001;
      camera.far = size * 100;
      camera.updateProjectionMatrix();
      controls.minDistance = size * 0.05;
      controls.maxDistance = size * 20;
      controls.update();
    };

    const handleLoaded = (obj: THREE.Object3D) => {
      fitCamera(obj);
      scene.add(obj);
      setLoading(false);
    };

    const handleLoadError = (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setLoadError(true);
      setLoading(false);
      onError(e);
    };

    const ext = filename.split('.').pop()?.toLowerCase();

    if (ext === 'glb' || ext === 'gltf') {
      new GLTFLoader().load(url, (gltf) => handleLoaded(gltf.scene), undefined, handleLoadError);
    } else if (ext === 'obj') {
      new OBJLoader().load(url, handleLoaded, undefined, handleLoadError);
    } else if (ext === 'stl') {
      new STLLoader().load(
        url,
        (geometry) => {
          geometry.computeVertexNormals();
          handleLoaded(
            new THREE.Mesh(
              geometry,
              new THREE.MeshPhongMaterial({ color: 0x9999cc, specular: 0x333333, shininess: 30 }),
            ),
          );
        },
        undefined,
        handleLoadError,
      );
    } else {
      handleLoadError(new Error(`Unsupported 3D format: .${ext}`));
    }

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      // Traverse scene and free GPU-side geometry, material, and texture memory
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            for (const key of Object.keys(mat)) {
              const val = (mat as unknown as Record<string, unknown>)[key];
              if (val instanceof THREE.Texture) val.dispose();
            }
            mat.dispose();
          }
        }
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [url, filename, onError]);

  if (loadError) {
    return <FallbackViewer downloadHref={downloadHref} filename={filename} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={mountRef} className="flex-1 relative overflow-hidden">
        {loading && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-surface-0 z-10"
            role="status"
            aria-label="Loading 3D model"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-surface-4 border-t-accent animate-spin" />
              <p className="text-sm text-content-secondary">Loading 3D model…</p>
            </div>
          </div>
        )}
      </div>
      <div className="bg-surface-1 border-t border-border px-5 py-3 flex items-center gap-4 flex-shrink-0 text-xs">
        <span className="text-content-muted">Drag to rotate · Scroll to zoom · Right-drag to pan</span>
        <a
          href={downloadHref}
          download={filename}
          className="btn-secondary btn-sm text-xs ml-auto"
          aria-label={`Download ${filename}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download
        </a>
      </div>
    </div>
  );
}
