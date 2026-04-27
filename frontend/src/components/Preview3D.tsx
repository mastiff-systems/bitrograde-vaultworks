import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { downloadUrl } from '../api/client.js';

interface Props {
  assetId: string;
}

export function Preview3D({ assetId }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.clientWidth || 640;
    const H = 400;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.01, 1000);
    camera.position.set(0, 1, 3);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const url = downloadUrl(assetId);
    const isObj = url.toLowerCase().includes('.obj');

    const onLoad = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      obj.position.sub(center);
      camera.position.set(0, size * 0.3, size * 1.2);
      controls.update();
      scene.add(obj);
    };

    if (isObj) {
      new OBJLoader().load(url, onLoad);
    } else {
      new GLTFLoader().load(url, (gltf) => onLoad(gltf.scene));
    }

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [assetId]);

  return (
    <div
      ref={mountRef}
      style={{ width: '100%', height: 400, borderRadius: 4, overflow: 'hidden' }}
    />
  );
}
