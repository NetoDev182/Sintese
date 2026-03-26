

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURAÇÃO BÁSICA ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000001, 0.001);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 5000);
camera.position.set(0, 150, 500);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// --- EFEITO BLOOM (ESTÉTICA NEON) ---
const renderScene = new RenderPass(scene, camera);
// Parâmetros do Bloom: Resolução, Intensidade, Raio, Threshold
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 2.5, 0.6, 0.05);
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- LÓGICA DE GEOMETRIA MUTANTE (GPU MORPHING) ---
const PARTICLE_COUNT = 80000;
const particleGeometry = new THREE.BufferGeometry();

// Função auxiliar para criar e extrair posições de geometrias padrão
function getPositions(geometry) {
    const num = geometry.attributes.position.count;
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const geoPositions = geometry.attributes.position.array;
    
    // Preenche as partículas com os pontos da geometria, repetindo se necessário
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        positions[i3] = geoPositions[(i % num) * 3];
        positions[i3+1] = geoPositions[(i % num) * 3 + 1];
        positions[i3+2] = geoPositions[(i % num) * 3 + 2];
    }
    geometry.dispose(); // Limpa a geometria auxiliar da memória CPU
    return positions;
}

// 1. Gera as posições das 4 formas diferentes
// Esfera, Toroide, Nó Toroidal, Caixa
const posSphere = getPositions(new THREE.SphereGeometry(200, 128, 128));
const posTorus = getPositions(new THREE.TorusGeometry(150, 40, 64, 128));
const posKnot = getPositions(new THREE.TorusKnotGeometry(120, 35, 200, 32));
const posBox = getPositions(new THREE.BoxGeometry(250, 250, 250, 64, 64, 64));

// Atributos aleatórios para variação de cor e agitação
const randomOffsets = new Float32Array(PARTICLE_COUNT);
for (let i = 0; i < PARTICLE_COUNT; i++) randomOffsets[i] = Math.random() * 2.0 - 1.0;

// Configura a BufferGeometry principal com as 4 formas como atributos
particleGeometry.setAttribute('position', new THREE.BufferAttribute(posSphere, 3)); // Forma A (Padrão)
particleGeometry.setAttribute('posTorus', new THREE.BufferAttribute(posTorus, 3));   // Forma B
particleGeometry.setAttribute('posKnot', new THREE.BufferAttribute(posKnot, 3));    // Forma C
particleGeometry.setAttribute('posBox', new THREE.BufferAttribute(posBox, 3));      // Forma D
particleGeometry.setAttribute('aRandom', new THREE.BufferAttribute(randomOffsets, 1));

// --- VARIÁVEIS UNIFORMS (CPU -> GPU) ---
let audioUniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uTreble: { value: 0 },
    
    // Controles de Morphing (Qual forma exibir)
    // Usamos um vetor de 4 dimensões para controlar o peso de cada forma (0.0 a 1.0)
    uMorphWeights: { value: new THREE.Vector4(1, 0, 0, 0) } 
};

// --- SHADERS (A MATEMÁTICA DA DEFORMAÇÃO) ---
const vertexShader = `
    uniform float uTime;
    uniform float uBass;
    uniform float uTreble;
    uniform vec4 uMorphWeights; // [Sphere, Torus, Knot, Box]
    
    attribute vec3 posTorus;
    attribute vec3 posKnot;
    attribute vec3 posBox;
    attribute float aRandom;
    varying vec3 vColor;

    void main() {
        // --- MORPHING LÓGICA ---
        // Combina linearmente as 4 posições baseadas nos pesos definidos na CPU
        vec3 morphedPos = position * uMorphWeights.x + 
                          posTorus * uMorphWeights.y + 
                          posKnot * uMorphWeights.z + 
                          posBox * uMorphWeights.w;
        
        vec3 finalPos = morphedPos;
        float dist = length(finalPos);
        
        // --- DEFORMAÇÃO POR ÁUDIO ---
        // Graves pulsão a escala global do objeto de dentro para fora
        finalPos *= (1.0 + uBass * 0.4);
        
        // Agudos agitam cada partícula individualmente usando seno e fator aleatório
        float trembleFactor = uTreble * 25.0 * aRandom;
        finalPos.x += sin(uTime * 10.0 + aRandom * 10.0) * trembleFactor;
        finalPos.y += cos(uTime * 12.0 + aRandom * 8.0) * trembleFactor;
        finalPos.z += sin(uTime * 8.0 + aRandom * 12.0) * trembleFactor;

        // --- COR DINÂMICA (Baseada na forma e áudio) ---
        // Tons de Rosa Neon para tons de Dourado baseado na intensidade do grave
        vColor = mix(vec3(1.0, 0.0, 0.33), vec3(1.0, 0.8, 0.0), uBass);
        
        // Variação de cor sutil baseada na posição do ponto
        vColor += normalize(finalPos) * 0.15;

        vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
        
        // Tamanho do ponto pulsa levemente e diminui com a distância
        gl_PointSize = (1.5 + uBass * 2.0) * (350.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying vec3 vColor;
    void main() {
        // Ponto circular suave
        float distToCenter = length(gl_PointCoord.xy - vec2(0.5));
        if (distToCenter > 0.5) discard;
        
        // Transparência na borda da partícula
        float alpha = smoothstep(0.5, 0.1, distToCenter);
        gl_FragColor = vec4(vColor, alpha);
    }
`;

const particleMaterial = new THREE.ShaderMaterial({
    uniforms: audioUniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    blending: THREE.AdditiveBlending,
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
        statusText.innerText = "Sincronizado. A escultura está ouvindo.";
        statusText.style.color = "#ff0055";
        
        // Inicia o timer de mudança aleatória de forma
        startMorphTimer();
    } catch (err) {
        statusText.innerText = "Erro no microfone. Verifique as permissões.";
        statusText.style.color = "#ff4757";
        console.error(err);
    }
});

// --- LÓGICA DE MORPHING ALEATÓRIO (TIMER) ---
let targetShapeIndex = 0;
// Usamos uma cópia para interpolar suavemente na animação
let currentWeights = new THREE.Vector4(1, 0, 0, 0); 

function startMorphTimer() {
    // A cada 7 segundos, escolhe uma nova forma alvo diferente da atual
    setInterval(() => {
        let newIndex;
        do {
            newIndex = Math.floor(Math.random() * 4);
        } while (newIndex === targetShapeIndex);
        
        targetShapeIndex = newIndex;
    }, 7000);
}

function updateMorphing(dt) {
    if (!isAudioInitialized) return;
    
    // Define o vetor de pesos alvo (ex: [0, 1, 0, 0] para Torus)
    const targetWeights = new THREE.Vector4(0, 0, 0, 0);
    if (targetShapeIndex === 0) targetWeights.x = 1;
    if (targetShapeIndex === 1) targetWeights.y = 1;
    if (targetShapeIndex === 2) targetWeights.z = 1;
    if (targetShapeIndex === 3) targetWeights.w = 1;
    
    // Interpola suavemente os pesos atuais em direção aos pesos alvo (Lerp)
    const lerpFactor = dt * 1.5; // Velocidade da transformação
    currentWeights.x += (targetWeights.x - currentWeights.x) * lerpFactor;
    currentWeights.y += (targetWeights.y - currentWeights.y) * lerpFactor;
    currentWeights.z += (targetWeights.z - currentWeights.z) * lerpFactor;
    currentWeights.w += (targetWeights.w - currentWeights.w) * lerpFactor;
    
    // Atualiza o uniform na GPU
    audioUniforms.uMorphWeights.value.copy(currentWeights);
}

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
    const dt = clock.getDelta(); // Tempo desde o último frame
    
    audioUniforms.uTime.value = time;
    
    // Rotação suave automática
    sculpture.rotation.y = time * 0.1;
    sculpture.rotation.z = time * 0.05;

    // Processa Áudio e Morphing
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
        
        updateMorphing(dt);
    }
    
    composer.render();
}

animate();
