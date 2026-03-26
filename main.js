import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// --- SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.z = 500;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('canvas-container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// --- POST PROCESSING (O Brilho) ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.1);
composer.addPass(bloom);

// --- PARTÍCULAS ---
const count = 120000;
const geometry = new THREE.BufferGeometry();
const pos = new Float32Array(count * 3);
const rand = new Float32Array(count);

for(let i=0; i<count; i++) {
    const r = Math.random() * 250;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    pos[i*3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = r * Math.cos(phi);
    rand[i] = Math.random();
}

geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geometry.setAttribute('aRandom', new THREE.BufferAttribute(rand, 1));

const uniforms = {
    uTime: { value: 0 },
    uAudio: { value: 0 }
};

const vertexShader = `
    uniform float uTime;
    uniform float uAudio;
    attribute float aRandom;
    varying vec3 vColor;

    // Simplex Noise para movimento fluido
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy * 2.0;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))+i.y + vec4(0.0, i1.y, i2.y, 1.0))+i.x + vec4(0.0, i1.x, i2.x, 1.0));
        vec3 h = abs(p.xyz * (1.0/7.0) - 0.5) - 0.5;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, h);
    }

    void main() {
        vec3 p = position;
        float noise = snoise(p * 0.005 + uTime * 0.2);
        
        // Deslocamento orgânico (LaTeX: P_{final} = P_{initial} + \vec{n} \cdot A)
        p += normalize(p) * noise * (50.0 + uAudio * 200.0);
        
        // Agitação local
        p.y += sin(uTime * 2.0 + aRandom * 10.0) * (10.0 + uAudio * 50.0);

        vColor = mix(vec3(0.0, 1.0, 0.8), vec3(0.6, 0.0, 1.0), noise * 0.5 + 0.5);
        vColor += uAudio * 0.5;

        vec4 mvp = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (2.0 + uAudio * 4.0) * (350.0 / -mvp.z);
        gl_Position = projectionMatrix * mvp;
    }
`;

const fragmentShader = `
    varying vec3 vColor;
    void main() {
        if(length(gl_PointCoord - 0.5) > 0.5) discard;
        gl_FragColor = vec4(vColor, 0.8);
    }
`;

const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
});

const cloud = new THREE.Points(geometry, material);
scene.add(cloud);

// --- AUDIO ---
let analyser, data;
document.getElementById('start-btn').addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        data = new Uint8Array(analyser.frequencyBinCount);
        document.getElementById('status').innerText = "Ouvindo...";
        document.getElementById('start-btn').style.opacity = "0.5";
    } catch(e) {
        alert("Erro no microfone!");
    }
});

// --- LOOP ---
function animate() {
    requestAnimationFrame(animate);
    const t = performance.now() * 0.001;
    uniforms.uTime.value = t;

    if(analyser) {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for(let i=0; i<data.length; i++) sum += data[i];
        uniforms.uAudio.value = (sum / data.length) / 255;
    }

    cloud.rotation.y += 0.001;
    controls.update();
    composer.render();
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});
