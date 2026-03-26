import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURAÇÃO BÁSICA ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x010101, 0.001);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 5000);
camera.position.set(0, 200, 600);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// --- EFEITO BLOOM (ESTÉTICA DE ENERGIA) ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 2.5, 0.6, 0.1);
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- LÓGICA DE PARTÍCULAS ORGÂNICAS (SEM GEOMETRIA) ---
const PARTICLE_COUNT = 100000; // 100k partículas para visual volumétrico
const particleGeometry = new THREE.BufferGeometry();

// Preenchemos com posições aleatórias brutas em um volume esférico
const positions = new Float32Array(PARTICLE_COUNT * 3);
const randomOffsets = new Float32Array(PARTICLE_COUNT);

for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    
    // Distribuição de volume esférico aleatório (esfera nebulosa)
    const radius = Math.cbrt(Math.random()) * 250; 
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    
    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i3+1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i3+2] = radius * Math.cos(phi);

    // Fator aleatório para o shader agitar cada partícula de forma diferente
    randomOffsets[i] = Math.random() * 100.0;
}

particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particleGeometry.setAttribute('aRandom', new THREE.BufferAttribute(randomOffsets, 1));

// --- VARIÁVEIS UNIFORMS (CPU -> GPU) ---
let audioUniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },   // Define a velocidade global do "ser" e sua escala
    uTreble: { value: 0 }  // Define o caos local nas bordas e o brilho
};

// --- SHADERS (A MATEMÁTICA DO FLUXO VIVO) ---
// Incluímos uma implementação de Simplex Noise 3D diretamente no Vertex Shader.
const vertexShader = `
    uniform float uTime;
    uniform float uBass;
    uniform float uTreble;
    attribute float aRandom;
    varying vec3 vColor;

    // --- Início do Simplex Noise 3D ---
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
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy * 2.0;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute( permute( permute(
                  i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
        float n_ = 0.142857142857;
        vec3 h = abs(p.xyz * n_ - vec4(0.0, 0.5, 1.0, 2.0).xyz) - 0.5;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, h );
    }
    // --- Fim do Simplex Noise ---

    void main() {
        vec3 pos = position;
        
        // 1. FLUXO ORGANICO (Flow Field)
        // Usamos ruído 3D para definir a velocidade e direção de fluxo para cada partícula
        // O ruído muda com uTime, uBass controla a frequência e velocidade desse fluxo.
        float noiseFreq = 0.005 + uBass * 0.01;
        float noiseSpeed = uTime * (0.2 + uBass);
        vec3 noiseCoords = pos * noiseFreq + noiseSpeed + aRandom * 0.1;
        
        float flowX = snoise(noiseCoords);
        float flowY = snoise(noiseCoords + vec3(100.0));
        float flowZ = snoise(noiseCoords + vec3(200.0));
        vec3 flow = vec3(flowX, flowY, flowZ);
        
        // Aplica o fluxo como deformação na posição original.
        // Bass define a amplitude dessa deformação orgânica.
        pos += flow * (50.0 + uBass * 150.0);
        
        // 2. AGITAÇÃO DE CAOS LOCAL (Agudos)
        // Caos local nas bordas, agitando as partículas de forma aleatória.
        pos.y += sin(uTime * 15.0 + aRandom) * uTreble * 30.0;
        pos.x += cos(uTime * 18.0 + aRandom) * uTreble * 20.0;

        // --- COR DINÂMICA (Baseada no fluxo e áudio) ---
        // Lerp entre Ciano Neon (Tranquilo) e Magenta Neon (Alta energia/Grave)
        vColor = mix(vec3(0.0, 1.0, 0.8), vec3(1.0, 0.0, 1.0), uBass);
        
        // Jitter de cor baseado nos agudos
        vColor += vec3(uTreble * 0.3);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        
        // Tamanho do ponto pulsa levemente e diminui com a distância
        gl_PointSize = (2.0 + uBass * 3.0) * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying vec3 vColor;
    void main() {
        // Ponto circular suave
        float distToCenter = length(gl_PointCoord.xy - vec2(0.5));
        if (distToCenter > 0.5) discard;
        
        // Transparência na borda da partícula (soft cloud)
        float alpha = smoothstep(0.5, 0.1, distToCenter);
        gl_FragColor = vec4(vColor, alpha * 0.8);
    }
`;

const particleMaterial = new THREE.ShaderMaterial({
    uniforms: audioUniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    blending: THREE.AdditiveBlending, // Fundamental para estética de energia
    depthWrite: false,
    transparent: true
});

const sculpture = new THREE.Points(particleGeometry, particleMaterial);
scene.add(sculpture);

// --- LÓGICA DE ÁUDIO (MICROFONE) ---
let audioContext, analyser, dataArray;
let isAudioInitialized = false;

const startBtn = document.getElementById('start-audio-btn');
const statusText = document.getElementById('status-text');

startBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256; 
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        isAudioInitialized = true;
        
        startBtn.style.display = 'none';
        statusText.innerText = "Sincronizado. O ser está ouvindo.";
        statusText.style.color = "#00ffcc";
        
    } catch (err) {
        statusText.innerText = "Erro no microfone. Verifique as permissões.";
        statusText.style.color = "#ff4757";
        console.error(err);
    }
});

// --- RESIZE & LOOP DE ANIMAÇÃO ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    const time = clock.getElapsedTime();
    
    audioUniforms.uTime.value = time;
    
    // Processa Áudio
    if (isAudioInitialized) {
        analyser.getByteFrequencyData(dataArray);
        
        // Média de Graves (bins 0-10)
        let bass = 0;
        for (let i = 0; i < 10; i++) bass += dataArray[i];
        audioUniforms.uBass.value = (bass / 10) / 255;
        
        // Média de Agudos (bins 100-128)
        let treble = 0;
        for (let i = 100; i < 128; i++) treble += dataArray[i];
        audioUniforms.uTreble.value = (treble / 28) / 255;
    }
    
    // Render via composer (brilho)
    composer.render();
}

animate();
