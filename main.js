import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==========================================
// 1. CONFIGURAÇÃO DA CENA E BRILHO (AURA)
// ==========================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020202, 0.002);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
camera.position.set(0, 0, 500);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5; // Rotação mais lenta e contemplativa

// Adicionando o "Bloom" (Brilho Neon)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.8, 0.5, 0.1);
composer.addPass(bloomPass);

// ==========================================
// 2. A GEOMETRIA DA ENTIDADE
// ==========================================
const PARTICLE_COUNT = 60000; 
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(PARTICLE_COUNT * 3);
const randomOffsets = new Float32Array(PARTICLE_COUNT); // Para individualidade de cada partícula

for (let i = 0; i < PARTICLE_COUNT; i++) {
    const r = 180 * Math.cbrt(Math.random()); 
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    
    randomOffsets[i] = Math.random() * Math.PI * 2; // Deslocamento aleatório
}

geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('aRandom', new THREE.BufferAttribute(randomOffsets, 1));

const uniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },   // Graves
    uTreble: { value: 0 }  // Agudos
};

// ==========================================
// 3. O CÉREBRO DA ENTIDADE (SHADERS)
// ==========================================
const vertexShader = `
    uniform float uTime;
    uniform float uBass;
    uniform float uTreble;
    attribute float aRandom;
    varying vec3 vColor;

    void main() {
        vec3 pos = position;
        float dist = length(pos);
        
        // 1. RESPIRAÇÃO (Breathing) - Movimento constante mesmo sem som
        float breath = sin(uTime * 1.5 + dist * 0.01) * 0.05 + 0.95;
        pos *= breath;

        // 2. ANATOMIA FLUIDA (Pseudo-Noise Seguro)
        // Cruzamos ondas trigonométricas para criar deformações de "ameba"
        float speed = uTime * 0.5;
        vec3 organicFlow = vec3(
            sin(pos.y * 0.015 + speed) * cos(pos.z * 0.015 + speed),
            cos(pos.x * 0.015 + speed) * sin(pos.z * 0.015 + speed),
            sin(pos.x * 0.015 + speed) * cos(pos.y * 0.015 + speed)
        );
        
        // A deformação aumenta com a distância do centro (tentáculos)
        pos += organicFlow * (30.0 + uBass * 100.0);

        // 3. REAÇÃO AO ÁUDIO
        // Graves (Bass) expandem o núcleo
        pos += normalize(pos) * (uBass * 120.0);
        
        // Agudos (Treble) causam espasmos nas bordas
        pos.y += sin(uTime * 10.0 + aRandom) * uTreble * 40.0;

        // 4. COLORIZAÇÃO DINÂMICA
        // Núcleo mais escuro/azulado, bordas mais ciano/magenta dependendo do fluxo
        float flowIntensity = length(organicFlow);
        vec3 colorCore = vec3(0.0, 0.2, 0.8);
        vec3 colorEdge = vec3(0.0, 1.0, 0.8); // Ciano
        vec3 colorAgitated = vec3(1.0, 0.0, 0.6); // Magenta quando há som agudo
        
        float mixFactor = smoothstep(0.0, 200.0, dist);
        vColor = mix(colorCore, colorEdge, mixFactor);
        
        // Fica magenta/rosa com os agudos (nervosismo)
        vColor = mix(vColor, colorAgitated, uTreble);
        
        // Aumenta o brilho total com os graves
        vColor += vec3(uBass * 0.4);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = (2.0 + uBass * 5.0 + uTreble * 3.0) * (400.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying vec3 vColor;
    void main() {
        float distToCenter = length(gl_PointCoord - vec2(0.5));
        if(distToCenter > 0.5) discard;
        
        // Borda suave (Soft particle) em vez de dura
        float alpha = smoothstep(0.5, 0.1, distToCenter);
        gl_FragColor = vec4(vColor, alpha * 0.9);
    }
`;

const material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

const points = new THREE.Points(geometry, material);
scene.add(points);

// ==========================================
// 4. CAPTURA DE ÁUDIO SEPARADO (Graves e Agudos)
// ==========================================
let audioContext, analyser, dataArray;
let isListening = false;
let currentBass = 0;
let currentTreble = 0;

const btn = document.getElementById('btn-iniciar');
const statusDisplay = document.getElementById('status');

btn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512; // Maior resolução para separar melhor graves e agudos
        
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        isListening = true;
        btn.style.display = 'none';
        statusDisplay.innerText = "Entidade viva e conectada.";
        statusDisplay.style.color = "#00ffcc";

    } catch (err) {
        statusDisplay.innerText = "Erro no microfone. Verifique as permissões.";
        statusDisplay.style.color = "#ff3333";
    }
});

// ==========================================
// 5. MOTOR DE ANIMAÇÃO
// ==========================================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime();
    uniforms.uTime.value = time;

    if (isListening) {
        analyser.getByteFrequencyData(dataArray);
        
        // Pegando os Graves (Bass) - Posições 0 a 10 no array
        let bassSum = 0;
        for(let i = 0; i < 10; i++) bassSum += dataArray[i];
        let targetBass = (bassSum / 10) / 255.0;
        
        // Pegando os Agudos (Treble) - Posições 150 a 200 no array
        let trebleSum = 0;
        let countTreble = 0;
        for(let i = 150; i < 200; i++) {
            trebleSum += dataArray[i];
            countTreble++;
        }
        let targetTreble = (trebleSum / countTreble) / 255.0;
        
        // Suavização (Lerp) independente
        currentBass += (targetBass - currentBass) * 0.2;
        currentTreble += (targetTreble - currentTreble) * 0.15;
        
        uniforms.uBass.value = currentBass;
        uniforms.uTreble.value = currentTreble;
    }

    controls.update();
    
    // ATENÇÃO: Mudamos de renderer.render para composer.render para ativar o Brilho!
    composer.render();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
