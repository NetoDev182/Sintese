import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ==========================================
// 1. CONFIGURAÇÃO DA CENA (O Palco)
// ==========================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050505, 0.0015); // Neblina para profundidade

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
camera.position.set(0, 150, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true; // Gira a câmera lentamente sozinha
controls.autoRotateSpeed = 1.0;

// ==========================================
// 2. CRIAÇÃO DAS PARTÍCULAS (A Entidade)
// ==========================================
const PARTICLE_COUNT = 50000; // Reduzido para garantir 60fps em qualquer celular
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(PARTICLE_COUNT * 3);

// Cria uma esfera inicial de partículas
for (let i = 0; i < PARTICLE_COUNT; i++) {
    const r = 150 * Math.cbrt(Math.random()); // Distribuição dentro da esfera
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
}

geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

// Variáveis que enviamos para a Placa de Vídeo (GPU)
const uniforms = {
    uTime: { value: 0 },
    uAudio: { value: 0 }
};

// Shader Ultra-Seguro (Sem funções complexas que quebram em mobile)
const vertexShader = `
    uniform float uTime;
    uniform float uAudio;
    varying vec3 vColor;

    void main() {
        vec3 pos = position;
        
        // Distância do centro
        float dist = length(pos);
        
        // Efeito Torção (Twist): Gira mais forte nas bordas
        float angle = uTime * 0.5 + dist * 0.02;
        float s = sin(angle);
        float c = cos(angle);
        
        // Aplica a rotação no eixo Y
        vec3 twistedPos = vec3(
            pos.x * c - pos.z * s,
            pos.y,
            pos.x * s + pos.z * c
        );
        
        // Microfone: Expande a entidade de dentro pra fora
        twistedPos += normalize(twistedPos) * (uAudio * 150.0);
        
        // Cores baseadas na altura (Y) e no som
        float heightPercent = (twistedPos.y + 150.0) / 300.0;
        vec3 colorBottom = vec3(0.0, 0.5, 1.0); // Azul
        vec3 colorTop = vec3(1.0, 0.0, 0.5);    // Rosa
        vColor = mix(colorBottom, colorTop, heightPercent);
        vColor += vec3(uAudio * 0.5); // Fica branco/brilhante quando o som bate forte

        vec4 mvPosition = modelViewMatrix * vec4(twistedPos, 1.0);
        
        // Tamanho da partícula diminui com a distância
        gl_PointSize = (2.0 + uAudio * 6.0) * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying vec3 vColor;
    void main() {
        // Recorta o quadrado para virar uma bolinha perfeita
        float distToCenter = length(gl_PointCoord - vec2(0.5));
        if(distToCenter > 0.5) discard;
        
        gl_FragColor = vec4(vColor, 0.9);
    }
`;

const material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending, // Faz as cores se somarem (efeito neon)
    depthWrite: false
});

const points = new THREE.Points(geometry, material);
scene.add(points);

// ==========================================
// 3. CAPTURA DE ÁUDIO (Com Feedback de Erro)
// ==========================================
let audioContext, analyser, dataArray;
let isListening = false;
let currentAudioLevel = 0;

const btn = document.getElementById('btn-iniciar');
const statusDisplay = document.getElementById('status');

btn.addEventListener('click', async () => {
    statusDisplay.innerText = "Pedindo permissão...";
    statusDisplay.style.color = "#ffdd00";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        isListening = true;
        btn.style.display = 'none'; // Some com o botão
        statusDisplay.innerText = "🔊 Ouvindo perfeitamente!";
        statusDisplay.style.color = "#00ffcc";

    } catch (err) {
        console.error("Erro no áudio:", err);
        if (err.name === 'NotAllowedError') {
            statusDisplay.innerText = "❌ Permissão negada! Libere o microfone no navegador.";
        } else if (err.name === 'NotFoundError') {
            statusDisplay.innerText = "❌ Nenhum microfone encontrado neste aparelho.";
        } else {
            statusDisplay.innerText = "❌ Erro ao acessar microfone: " + err.message;
        }
        statusDisplay.style.color = "#ff3333";
    }
});

// ==========================================
// 4. MOTOR DE ANIMAÇÃO (O Loop)
// ==========================================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime();
    uniforms.uTime.value = time; // Atualiza o tempo na GPU

    // Processa o som se estiver ouvindo
    if (isListening) {
        analyser.getByteFrequencyData(dataArray);
        
        // Tira a média do volume
        let sum = 0;
        for(let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        let targetLevel = (sum / dataArray.length) / 255.0; // Valor entre 0 e 1
        
        // Suavização (Lerp) para não piscar violentamente
        currentAudioLevel += (targetLevel - currentAudioLevel) * 0.15;
        uniforms.uAudio.value = currentAudioLevel;
    }

    controls.update(); // Necessário para o autoRotate funcionar
    renderer.render(scene, camera);
}

// Adapta a tela se o celular for virado de lado
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Inicia o motor!
animate();
