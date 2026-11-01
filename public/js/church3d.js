/**
 * Church3D — Cảnh Nhà thờ 3D THẬT (Three.js), khung dọc 9:16 cho TikTok Live / OBS.
 *  - Gian giữa có hàng cột, vòm trần, cửa kính màu hai bên + cửa sổ hoa hồng sau bàn thờ
 *  - Ánh nắng xiên qua kính màu (tia sáng thể tích), bụi lơ lửng, đèn chùm, bóng đổ thật
 *  - Giá nến dâng (봉헌초) sáng dần theo số nến người xem thắp; người ngồi ghế cúi đầu khi cầu nguyện
 *  - Hậu kỳ: bloom (quầng sáng), vignette (tối 4 góc), tone mapping kiểu điện ảnh
 * Mọi hoạ tiết (gỗ, đá, thảm, kính màu) được VẼ BẰNG MÃ => không phụ thuộc ảnh có bản quyền.
 *
 * Tham số URL: ?fx3d=0 (tắt 3D) &q=0.75 (độ phân giải) &fps=30 &shadows=0 &bloom=0.6 &camt=10 (đóng băng camera)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const params = new URLSearchParams(location.search);
const num = (k, d, lo, hi) => {
  const v = parseFloat(params.get(k));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
};
const QUALITY = num('q', 1, 0.4, 1);
const FPS = num('fps', 30, 10, 60);
const BLOOM = num('bloom', 0.62, 0, 2);
const SHADOWS = params.get('shadows') !== '0';
const CAM_T = params.has('camt') ? parseFloat(params.get('camt')) : null;
const STAGE_W = 1080;
const STAGE_H = 1920;

// ---------------------------------------------------------------------------
// 0. Kích thước gian nhà thờ (mét)
// ---------------------------------------------------------------------------
const HALL = { halfW: 8, back: -34, front: 7, wallH: 9.2, vaultR: 8 };
const ALTAR_Z = -28.6;
const COLUMN_X = 5.3;
const COLUMN_ZS = [-26, -21.5, -17, -12.5, -8, -3.5, 1];
const PEW_ROWS = 16;
const PEW_FIRST_Z = -22.2; // hàng ghế đầu (gần bàn thờ)
const PEW_STEP = 1.32;
const PEW_LEN = 3.6;
const PEW_INNER_X = 0.95; // mép trong (sát lối đi)
const SEATS_PER_PEW = 6;

// ---------------------------------------------------------------------------
// 1. Tiện ích: số ngẫu nhiên có hạt giống + vẽ texture bằng canvas
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function noiseSpeckle(ctx, w, h, rand, count, alpha, light = false) {
  for (let i = 0; i < count; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

const TEX = {
  wood: () =>
    canvasTexture(512, 512, (ctx, w, h) => {
      const rand = mulberry32(7);
      ctx.fillStyle = '#5b351c';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) {
        const y = rand() * h;
        ctx.strokeStyle = rand() > 0.5 ? 'rgba(40,20,8,0.35)' : 'rgba(140,90,50,0.22)';
        ctx.lineWidth = 0.6 + rand() * 2.2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 * rand());
        ctx.stroke();
      }
      noiseSpeckle(ctx, w, h, rand, 3000, 0.12);
    }, { repeat: [2, 1] }),

  floor: () =>
    canvasTexture(1024, 1024, (ctx, w, h) => {
      const rand = mulberry32(11);
      const n = 4;
      const s = w / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const dark = (i + j) % 2 === 1;
          ctx.fillStyle = dark ? '#6e5f58' : '#d9cdb8';
          ctx.fillRect(i * s, j * s, s, s);
          // vân đá cẩm thạch
          ctx.strokeStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(90,70,60,0.14)';
          for (let k = 0; k < 5; k++) {
            ctx.lineWidth = 0.6 + rand() * 1.6;
            ctx.beginPath();
            let x = i * s + rand() * s;
            let y = j * s;
            ctx.moveTo(x, y);
            for (let t = 0; t < 10; t++) {
              x += (rand() - 0.5) * 40;
              y += s / 10;
              ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
      }
      ctx.strokeStyle = 'rgba(40,30,25,0.55)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s, 0);
        ctx.lineTo(i * s, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * s);
        ctx.lineTo(w, i * s);
        ctx.stroke();
      }
      noiseSpeckle(ctx, w, h, rand, 9000, 0.08);
    }, { repeat: [4, 10] }),

  carpet: () =>
    canvasTexture(256, 1024, (ctx, w, h) => {
      const rand = mulberry32(5);
      ctx.fillStyle = '#7d0f16';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c99a3a';
      ctx.fillRect(10, 0, 10, h);
      ctx.fillRect(w - 20, 0, 10, h);
      ctx.fillStyle = '#5c0a10';
      ctx.fillRect(26, 0, 4, h);
      ctx.fillRect(w - 30, 0, 4, h);
      ctx.strokeStyle = 'rgba(214,170,80,0.35)';
      ctx.lineWidth = 2;
      for (let y = 40; y < h; y += 128) {
        ctx.beginPath();
        ctx.moveTo(w / 2, y);
        ctx.lineTo(w / 2 + 40, y + 40);
        ctx.lineTo(w / 2, y + 80);
        ctx.lineTo(w / 2 - 40, y + 40);
        ctx.closePath();
        ctx.stroke();
      }
      noiseSpeckle(ctx, w, h, rand, 6000, 0.18);
    }, { repeat: [1, 6] }),

  plaster: () =>
    canvasTexture(512, 512, (ctx, w, h) => {
      const rand = mulberry32(3);
      ctx.fillStyle = '#cdbb9f';
      ctx.fillRect(0, 0, w, h);
      noiseSpeckle(ctx, w, h, rand, 16000, 0.07);
      noiseSpeckle(ctx, w, h, rand, 8000, 0.06, true);
      // đường mạch đá xây
      ctx.strokeStyle = 'rgba(80,60,40,0.18)';
      ctx.lineWidth = 2;
      for (let y = 0; y < h; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        for (let x = (y / 64) % 2 ? 64 : 0; x < w; x += 128) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 64);
          ctx.stroke();
        }
      }
    }, { repeat: [6, 3] }),

  // Cửa kính màu dạng vòm nhọn (lancet). Mỗi cửa một hạt giống => không cửa nào giống hệt.
  stainedGlass: (seed) =>
    canvasTexture(256, 640, (ctx, w, h) => {
      const rand = mulberry32(seed);
      const PALETTE = ['#1b3fa8', '#2756d6', '#b3122e', '#d8a21c', '#1f8a4c', '#6b2fa3', '#e0c45a', '#0f6fa8'];
      ctx.save();
      // khung vòm nhọn
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h * 0.28);
      ctx.quadraticCurveTo(0, 0, w / 2, 0);
      ctx.quadraticCurveTo(w, 0, w, h * 0.28);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.clip();
      const cols = 5;
      const rows = 13;
      const pts = [];
      for (let r = 0; r <= rows; r++) {
        pts.push([]);
        for (let c = 0; c <= cols; c++) {
          const jx = c === 0 || c === cols ? 0 : (rand() - 0.5) * 22;
          const jy = r === 0 || r === rows ? 0 : (rand() - 0.5) * 22;
          pts[r].push([(c / cols) * w + jx, (r / rows) * h + jy]);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const col = PALETTE[Math.floor(rand() * PALETTE.length)];
          const [a, b, d, e] = [pts[r][c], pts[r][c + 1], pts[r + 1][c + 1], pts[r + 1][c]];
          const g = ctx.createRadialGradient(a[0] + 20, a[1] + 20, 2, a[0] + 20, a[1] + 20, 70);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.25, col);
          g.addColorStop(1, col);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(...a);
          ctx.lineTo(...b);
          ctx.lineTo(...d);
          ctx.lineTo(...e);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#120c08';
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      }
      // huy chương giữa: thập tự trong vòng tròn
      const cx = w / 2;
      const cy = h * 0.42;
      ctx.beginPath();
      ctx.arc(cx, cy, 72, 0, Math.PI * 2);
      ctx.fillStyle = '#f2d06b';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#120c08';
      ctx.stroke();
      ctx.fillStyle = '#b3122e';
      ctx.fillRect(cx - 9, cy - 52, 18, 104);
      ctx.fillRect(cx - 38, cy - 22, 76, 18);
      ctx.restore();
      // viền khung đá
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#2a1d14';
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h * 0.28);
      ctx.quadraticCurveTo(0, 0, w / 2, 0);
      ctx.quadraticCurveTo(w, 0, w, h * 0.28);
      ctx.lineTo(w, h);
      ctx.stroke();
    }),

  // Cửa sổ hoa hồng (rose window) tròn sau bàn thờ
  roseWindow: () =>
    canvasTexture(1024, 1024, (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const R = w / 2 - 8;
      const PAL = ['#1b3fa8', '#b3122e', '#d8a21c', '#1f8a4c', '#6b2fa3', '#2756d6'];
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#0b0a14';
      ctx.fillRect(0, 0, w, h);
      const rings = [
        [R * 0.18, R * 0.0, 1, '#f5d77a'],
        [R * 0.42, R * 0.18, 8, null],
        [R * 0.7, R * 0.42, 16, null],
        [R * 0.98, R * 0.7, 24, null]
      ];
      rings.forEach(([outer, inner, segs, fixed], ri) => {
        for (let s = 0; s < segs; s++) {
          const a0 = (s / segs) * Math.PI * 2 - Math.PI / 2;
          const a1 = ((s + 1) / segs) * Math.PI * 2 - Math.PI / 2;
          const col = fixed || PAL[(s + ri * 2) % PAL.length];
          const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.3, col);
          g.addColorStop(1, col);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, outer, a0, a1);
          ctx.arc(cx, cy, inner, a1, a0, true);
          ctx.closePath();
          ctx.fill();
          ctx.lineWidth = 7;
          ctx.strokeStyle = '#120c08';
          ctx.stroke();
          if (ri >= 2) {
            // cánh hoa
            const am = (a0 + a1) / 2;
            const pr = (outer + inner) / 2;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(am) * pr, cy + Math.sin(am) * pr, (outer - inner) * 0.28, 0, Math.PI * 2);
            ctx.fillStyle = '#f5d77a';
            ctx.fill();
            ctx.stroke();
          }
        }
      });
      ctx.restore();
      ctx.lineWidth = 18;
      ctx.strokeStyle = '#2a1d14';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
    }),

  glow: () =>
    canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,240,200,0.55)');
      g.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),

  flame: () =>
    canvasTexture(64, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h * 0.68, 2, w / 2, h * 0.6, h * 0.5);
      g.addColorStop(0, 'rgba(255,255,240,1)');
      g.addColorStop(0.25, 'rgba(255,214,120,0.95)');
      g.addColorStop(0.6, 'rgba(255,130,30,0.45)');
      g.addColorStop(1, 'rgba(255,90,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w / 2, 4);
      ctx.bezierCurveTo(w * 0.95, h * 0.55, w * 0.85, h * 0.95, w / 2, h * 0.95);
      ctx.bezierCurveTo(w * 0.15, h * 0.95, w * 0.05, h * 0.55, w / 2, 4);
      ctx.fill();
    }),

  heart: () =>
    canvasTexture(64, 64, (ctx, w) => {
      ctx.fillStyle = '#ff5c8a';
      ctx.shadowColor = '#ffb3c8';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const s = w / 64;
      ctx.moveTo(32 * s, 54 * s);
      ctx.bezierCurveTo(4 * s, 34 * s, 8 * s, 10 * s, 32 * s, 22 * s);
      ctx.bezierCurveTo(56 * s, 10 * s, 60 * s, 34 * s, 32 * s, 54 * s);
      ctx.fill();
    })
};

// ---------------------------------------------------------------------------
// 2. Shader tia sáng thể tích (god rays): mờ ở mép, sáng ở lõi, nhạt dần về phía sàn
// ---------------------------------------------------------------------------
function makeShaftMaterial(color, strength) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 10 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      uniform float uSeed;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = abs(dot(normalize(vNormal), normalize(vView)));
        float core = pow(rim, 2.2);
        float along = smoothstep(0.0, 0.06, vUv.y) * (1.0 - vUv.y * 0.8);
        float shimmer = 0.85 + 0.15 * sin(uTime * 0.6 + vUv.x * 18.0 + uSeed);
        float a = core * along * shimmer * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`
  });
}

// Hậu kỳ: tối 4 góc + hạt phim rất nhẹ (cảm giác máy quay thật)
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: 0.42 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmount; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 1.25);
      float v = smoothstep(0.85, 0.25, length(d));
      c.rgb *= mix(1.0 - uAmount, 1.0, v);
      c.rgb += (rnd(vUv * 731.0) - 0.5) * 0.018;
      gl_FragColor = c;
    }`
};

// ---------------------------------------------------------------------------
// 3. Dựng cảnh
// ---------------------------------------------------------------------------
export function createChurch3D(canvas) {
  if (params.get('fx3d') === '0') return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    console.warn('[Church3D] Không khởi tạo được WebGL, dùng nền tĩnh:', err?.message);
    return null;
  }
  const RW = Math.round(STAGE_W * QUALITY);
  const RH = Math.round(STAGE_H * QUALITY);
  renderer.setPixelRatio(1);
  renderer.setSize(RW, RH, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = SHADOWS;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d0806');
  scene.fog = new THREE.FogExp2('#1d130c', 0.018);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;

  const camera = new THREE.PerspectiveCamera(55, STAGE_W / STAGE_H, 0.1, 120);
  const LOOK = new THREE.Vector3(0, 4.9, ALTAR_Z - 2);

  const textures = {
    wood: TEX.wood(),
    floor: TEX.floor(),
    carpet: TEX.carpet(),
    plaster: TEX.plaster(),
    rose: TEX.roseWindow(),
    glow: TEX.glow(),
    flame: TEX.flame(),
    heart: TEX.heart()
  };

  const M = {
    wood: new THREE.MeshStandardMaterial({ map: textures.wood, roughness: 0.55, metalness: 0.05 }),
    darkWood: new THREE.MeshStandardMaterial({ map: textures.wood, color: '#7a5a48', roughness: 0.6 }),
    floor: new THREE.MeshStandardMaterial({ map: textures.floor, roughness: 0.28, metalness: 0.0 }),
    carpet: new THREE.MeshStandardMaterial({ map: textures.carpet, roughness: 0.95 }),
    plaster: new THREE.MeshStandardMaterial({ map: textures.plaster, roughness: 0.92 }),
    stone: new THREE.MeshStandardMaterial({ color: '#b9a88e', roughness: 0.8 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d4a640', roughness: 0.28, metalness: 0.95 }),
    brass: new THREE.MeshStandardMaterial({ color: '#a7782f', roughness: 0.35, metalness: 0.9 }),
    linen: new THREE.MeshStandardMaterial({ color: '#f3eee2', roughness: 0.85 }),
    wax: new THREE.MeshStandardMaterial({ color: '#f7f0dc', roughness: 0.6, emissive: '#3a2a10', emissiveIntensity: 0.25 }),
    velvet: new THREE.MeshStandardMaterial({ color: '#6d0d18', roughness: 0.9 })
  };

  const add = (mesh, { cast = false, receive = false } = {}) => {
    mesh.castShadow = cast && SHADOWS;
    mesh.receiveShadow = receive && SHADOWS;
    scene.add(mesh);
    return mesh;
  };

  // --- Sàn, thảm, tường, vòm trần ---
  const hallLen = HALL.front - HALL.back;
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(HALL.halfW * 2, hallLen), M.floor), { receive: true });
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = (HALL.front + HALL.back) / 2;

  const carpet = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 30), M.carpet), { receive: true });
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.012, -9.5);

  for (const side of [-1, 1]) {
    const wall = add(new THREE.Mesh(new THREE.PlaneGeometry(hallLen, HALL.wallH), M.plaster), { receive: true });
    wall.position.set(side * HALL.halfW, HALL.wallH / 2, floor.position.z);
    wall.rotation.y = -side * Math.PI / 2;
  }
  const backWall = add(new THREE.Mesh(new THREE.PlaneGeometry(HALL.halfW * 2, HALL.wallH + HALL.vaultR), M.plaster), {
    receive: true
  });
  backWall.position.set(0, (HALL.wallH + HALL.vaultR) / 2, HALL.back);

  // Vòm trần bán nguyệt (mặt trong)
  const vault = add(
    new THREE.Mesh(
      new THREE.CylinderGeometry(HALL.vaultR, HALL.vaultR, hallLen, 40, 1, true, -Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ map: textures.plaster, color: '#bfae92', roughness: 0.95, side: THREE.BackSide })
    )
  );
  // Nửa trụ mặc định nằm phía +Z; xoay -90° quanh trục X để nửa đó hướng LÊN (y ≥ 0) thành vòm trần
  vault.rotation.x = -Math.PI / 2;
  vault.position.set(0, HALL.wallH, floor.position.z);

  // Gân vòm (sườn gỗ cong) + hàng cột đá
  const ribGeo = new THREE.TorusGeometry(HALL.vaultR - 0.05, 0.16, 8, 40, Math.PI);
  for (let z = HALL.back + 2; z < HALL.front; z += 4.5) {
    const rib = add(new THREE.Mesh(ribGeo, M.darkWood));
    rib.position.set(0, HALL.wallH, z);
  }
  const colGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.42, 0.48, HALL.wallH - 0.6, 20).translate(0, (HALL.wallH - 0.6) / 2 + 0.3, 0),
    new THREE.BoxGeometry(1.15, 0.3, 1.15).translate(0, 0.15, 0),
    new THREE.CylinderGeometry(0.62, 0.42, 0.45, 20).translate(0, HALL.wallH - 0.1, 0)
  ]);
  const colMesh = new THREE.InstancedMesh(colGeo, M.stone, COLUMN_ZS.length * 2);
  const tmp = new THREE.Object3D();
  let ci = 0;
  for (const side of [-1, 1]) {
    for (const z of COLUMN_ZS) {
      tmp.position.set(side * COLUMN_X, 0, z);
      tmp.updateMatrix();
      colMesh.setMatrixAt(ci++, tmp.matrix);
    }
  }
  add(colMesh, { cast: true, receive: true });
  // Vòm cuốn nối các cột
  const archGeo = new THREE.TorusGeometry(2.25, 0.2, 8, 24, Math.PI);
  const archMesh = new THREE.InstancedMesh(archGeo, M.stone, (COLUMN_ZS.length - 1) * 2);
  let ai = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < COLUMN_ZS.length - 1; i++) {
      tmp.position.set(side * COLUMN_X, HALL.wallH - 0.2, (COLUMN_ZS[i] + COLUMN_ZS[i + 1]) / 2);
      tmp.rotation.set(0, Math.PI / 2, 0);
      tmp.updateMatrix();
      archMesh.setMatrixAt(ai++, tmp.matrix);
    }
  }
  add(archMesh);
  tmp.rotation.set(0, 0, 0);

  // --- Cửa kính màu hai bên (bên trái hứng nắng => sáng hơn) ---
  const windows = [];
  let seed = 101;
  for (const side of [-1, 1]) {
    for (let i = 0; i < COLUMN_ZS.length - 1; i++) {
      const z = (COLUMN_ZS[i] + COLUMN_ZS[i + 1]) / 2;
      const mat = new THREE.MeshBasicMaterial({
        map: TEX.stainedGlass(seed++),
        transparent: true,
        alphaTest: 0.4,
        color: new THREE.Color().setScalar(side < 0 ? 2.4 : 1.25)
      });
      const win = add(new THREE.Mesh(new THREE.PlaneGeometry(1.9, 4.75), mat));
      win.position.set(side * (HALL.halfW - 0.02), 5.2, z);
      win.rotation.y = -side * Math.PI / 2;
      win.userData.base = side < 0 ? 2.4 : 1.25;
      windows.push(win);
    }
  }

  // --- Cung thánh: bục 3 bậc, bàn thờ phủ khăn, thập tự, cửa sổ hoa hồng ---
  for (let s = 0; s < 3; s++) {
    const step = add(
      new THREE.Mesh(new THREE.BoxGeometry(11.5 - s * 1.2, 0.22, 7.2 - s * 1.0), s === 2 ? M.velvet : M.stone),
      { receive: true, cast: true }
    );
    step.position.set(0, 0.11 + s * 0.22, ALTAR_Z - 1.6 - s * 0.5);
  }
  const altarTop = 0.66;
  const altar = add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.05, 1.2), M.wood), { cast: true, receive: true });
  altar.position.set(0, altarTop + 0.525, ALTAR_Z - 2.3);
  const cloth = add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 1.35), M.linen), { receive: true });
  cloth.position.set(0, altarTop + 1.07, ALTAR_Z - 2.3);
  const runner = add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.9, 0.02), M.velvet));
  runner.position.set(0, altarTop + 0.62, ALTAR_Z - 2.3 + 0.61);
  const runnerCross = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.01), M.gold));
  runnerCross.position.set(0, altarTop + 0.72, ALTAR_Z - 2.3 + 0.625);
  const runnerCrossH = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.01), M.gold));
  runnerCrossH.position.set(0, altarTop + 0.78, ALTAR_Z - 2.3 + 0.625);
  // Kinh Thánh mở trên bàn thờ
  const bible = add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.42), M.linen), { cast: true });
  bible.position.set(0, altarTop + 1.12, ALTAR_Z - 2.3);
  bible.rotation.x = -0.12;

  // Thập tự gỗ lớn trên tường sau + quầng sáng phía sau
  const CROSS_Y = 7.1;
  const crossV = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 5.2, 0.3), M.darkWood), { cast: true });
  crossV.position.set(0, CROSS_Y, HALL.back + 0.35);
  const crossH = add(new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.42, 0.3), M.darkWood), { cast: true });
  crossH.position.set(0, CROSS_Y + 1.05, HALL.back + 0.35);
  const crossGlowMat = new THREE.SpriteMaterial({
    map: textures.glow,
    color: '#ffd9a0',
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.55
  });
  const crossGlow = new THREE.Sprite(crossGlowMat);
  crossGlow.scale.set(9, 9, 1);
  crossGlow.position.set(0, CROSS_Y + 0.6, HALL.back + 0.12);
  scene.add(crossGlow);

  const roseMat = new THREE.MeshBasicMaterial({ map: textures.rose, transparent: true, alphaTest: 0.3, color: new THREE.Color().setScalar(2.2) });
  const rose = add(new THREE.Mesh(new THREE.CircleGeometry(2.3, 64), roseMat));
  rose.position.set(0, 12.6, HALL.back + 0.04);
  // Hai cửa kính cao hai bên thập tự
  for (const side of [-1, 1]) {
    const mat = new THREE.MeshBasicMaterial({ map: TEX.stainedGlass(900 + side), transparent: true, alphaTest: 0.4, color: new THREE.Color().setScalar(1.9) });
    const w = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 4.6), mat));
    w.position.set(side * 3.6, 6.4, HALL.back + 0.04);
    windows.push(Object.assign(w, { userData: { base: 1.9 } }));
  }

  // Nến cao + chân nến vàng trên bàn thờ
  const flames = [];
  const flameMat = new THREE.SpriteMaterial({
    map: textures.flame,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  function makeFlame(x, y, z, size) {
    const f = new THREE.Sprite(flameMat);
    f.position.set(x, y, z);
    f.scale.set(size * 0.5, size, 1);
    f.userData = { base: size, phase: Math.random() * 10, x, y };
    scene.add(f);
    flames.push(f);
    return f;
  }
  for (const side of [-1, 1]) {
    const stick = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.5, 12), M.gold), { cast: true });
    stick.position.set(side * 1.25, altarTop + 1.33, ALTAR_Z - 2.3);
    const candle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 12), M.wax));
    candle.position.set(side * 1.25, altarTop + 1.85, ALTAR_Z - 2.3);
    makeFlame(side * 1.25, altarTop + 2.22, ALTAR_Z - 2.3, 0.22);
  }

  // --- Giá nến dâng (봉헌초): 3 tầng × 12 nến = 36 chỗ, bên trái trước cung thánh ---
  const STAND = new THREE.Vector3(-2.9, 0, ALTAR_Z + 4.6);
  const standGroup = new THREE.Group();
  standGroup.position.copy(STAND);
  standGroup.rotation.y = 0.35;
  standGroup.scale.setScalar(1.25);
  scene.add(standGroup);
  const candleSlots = [];
  for (let t = 0; t < 3; t++) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.34), M.brass);
    tier.position.set(0, 0.85 + t * 0.32, -t * 0.3);
    tier.castShadow = SHADOWS;
    standGroup.add(tier);
    for (let k = 0; k < 12; k++) {
      const x = -1.05 + k * (2.1 / 11);
      candleSlots.push(new THREE.Vector3(x, 0.88 + t * 0.32, -t * 0.3));
    }
  }
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8);
  for (const lx of [-1.1, 1.1]) {
    for (const lz of [0.1, -0.7]) {
      const leg = new THREE.Mesh(legGeo, M.brass);
      leg.position.set(lx, 0.45, lz);
      standGroup.add(leg);
    }
  }
  const tealight = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), M.wax, candleSlots.length);
  candleSlots.forEach((p, i) => {
    tmp.position.set(p.x, p.y + 0.06, p.z);
    tmp.updateMatrix();
    tealight.setMatrixAt(i, tmp.matrix);
  });
  standGroup.add(tealight);
  const standFlames = candleSlots.map((p) => {
    const f = new THREE.Sprite(flameMat);
    f.position.set(p.x, p.y + 0.2, p.z);
    f.scale.set(0.06, 0.12, 1);
    f.visible = false;
    f.userData = { base: 0.13, phase: Math.random() * 10 };
    standGroup.add(f);
    return f;
  });
  const standLight = new THREE.PointLight('#ffb35c', 0, 7, 2);
  standLight.position.set(0, 1.5, 0.2);
  standGroup.add(standLight);
  const standGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: textures.glow, color: '#ffae55', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })
  );
  standGlow.scale.set(3.4, 2.2, 1);
  standGlow.position.set(0, 1.25, -0.2);
  standGroup.add(standGlow);

  // --- Hàng ghế gỗ (InstancedMesh: 1 lệnh vẽ cho toàn bộ ghế) ---
  const pewGeo = mergeGeometries([
    new THREE.BoxGeometry(PEW_LEN, 0.07, 0.46).translate(0, 0.46, 0), // mặt ngồi
    new THREE.BoxGeometry(PEW_LEN, 0.62, 0.06).translate(0, 0.86, 0.24), // lưng tựa
    new THREE.BoxGeometry(PEW_LEN, 0.05, 0.12).translate(0, 1.19, 0.24), // tay vịn trên
    new THREE.BoxGeometry(PEW_LEN, 0.2, 0.05).translate(0, 0.12, 0.42), // bục quỳ
    new THREE.BoxGeometry(0.07, 1.05, 0.62).translate(-PEW_LEN / 2, 0.52, 0.08), // hai đầu
    new THREE.BoxGeometry(0.07, 1.05, 0.62).translate(PEW_LEN / 2, 0.52, 0.08)
  ]);
  const pews = new THREE.InstancedMesh(pewGeo, M.wood, PEW_ROWS * 2);
  const pewCenters = [];
  let pi = 0;
  for (let r = 0; r < PEW_ROWS; r++) {
    const z = PEW_FIRST_Z + r * PEW_STEP;
    for (const side of [-1, 1]) {
      const cx = side * (PEW_INNER_X + PEW_LEN / 2);
      tmp.position.set(cx, 0, z);
      tmp.updateMatrix();
      pews.setMatrixAt(pi++, tmp.matrix);
      pewCenters.push({ r, side, cx, z });
    }
  }
  add(pews, { cast: true, receive: true });

  // --- Giáo dân ngồi trên ghế (tượng trưng, giản lược) ---
  const seats = [];
  for (const pc of pewCenters) {
    for (let k = 0; k < SEATS_PER_PEW; k++) {
      // k = 0 sát lối đi
      const x = pc.side * (PEW_INNER_X + 0.38 + k * ((PEW_LEN - 0.6) / (SEATS_PER_PEW - 1)));
      seats.push({ x, z: pc.z, row: pc.r, side: pc.side, k });
    }
  }
  const rand = mulberry32(42);
  // 6 ghế danh dự cho người ủng hộ nhiều nhất, xếp so le để thẻ tên không đè nhau:
  //  hạng 1-2: hàng đầu sát lối đi • 3-4: hàng đầu phía ngoài • 5-6: hàng thứ 3, giữa ghế
  const VIP_SLOTS = [[0, 0, -1], [0, 0, 1], [0, 4, -1], [0, 4, 1], [2, 2, -1], [2, 2, 1]];
  const vipSeatIdx = VIP_SLOTS.map(([row, k, side]) => seats.findIndex((s) => s.row === row && s.k === k && s.side === side));
  // hàng đầu dành cho 6 người ủng hộ nhiều nhất => luôn có người; các hàng khác ~55%
  const filled = seats.map((s, i) => vipSeatIdx.includes(i) || rand() < 0.55 - s.row * 0.012);
  const people = seats.filter((_, i) => filled[i]);
  const CLOTHES = ['#1f2a44', '#3b3b3f', '#6b5844', '#e8e2d6', '#2c3d2f', '#5a2430', '#45506b', '#151515'];
  const HAIR = ['#120c09', '#1c120c', '#2a1b12', '#3b2a20', '#8a8a8a'];
  const bodyGeo = mergeGeometries([
    new THREE.CapsuleGeometry(0.2, 0.42, 4, 10).translate(0, 0.86, 0),
    new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8).translate(0, 1.16, 0) // cổ
  ]);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), people.length);
  const heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.115, 14, 10),
    new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    people.length
  );
  const col = new THREE.Color();
  people.forEach((p, i) => {
    p.bow = 0;
    p.bowTarget = 0;
    p.sway = rand() * Math.PI * 2;
    p.idx = i;
    bodies.setColorAt(i, col.set(CLOTHES[Math.floor(rand() * CLOTHES.length)]));
    heads.setColorAt(i, col.set(HAIR[Math.floor(rand() * HAIR.length)]));
  });
  add(bodies, { cast: true });
  add(heads, { cast: true });

  function updatePeople(t) {
    for (const p of people) {
      p.bow += (p.bowTarget - p.bow) * 0.06;
      const breathe = Math.sin(t * 1.3 + p.sway) * 0.008;
      // thân hơi nghiêng về trước khi cúi đầu cầu nguyện
      tmp.position.set(p.x, 0, p.z - 0.02);
      tmp.rotation.set(-p.bow * 0.35, 0, 0);
      tmp.scale.set(1, 1 + breathe, 1);
      tmp.updateMatrix();
      bodies.setMatrixAt(p.idx, tmp.matrix);
      tmp.position.set(p.x, 1.33 + breathe - p.bow * 0.12, p.z - 0.02 - p.bow * 0.22);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1.08, 1);
      tmp.updateMatrix();
      heads.setMatrixAt(p.idx, tmp.matrix);
    }
    tmp.scale.set(1, 1, 1);
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  // --- Đèn chùm ---
  const chandelierLights = [];
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28a').multiplyScalar(3) });
  for (const z of [-6, -15, -23]) {
    const g = new THREE.Group();
    g.position.set(0, 9.4, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 8, 36), M.brass);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 7, 6), M.brass);
    chain.position.y = 3.5;
    g.add(chain);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bulbMat);
      bulb.position.set(Math.cos(a) * 1.05, 0.12, Math.sin(a) * 1.05);
      g.add(bulb);
    }
    const light = new THREE.PointLight('#ffc477', 26, 18, 1.6);
    light.position.y = -0.3;
    g.add(light);
    chandelierLights.push(light);
    scene.add(g);
  }

  // --- Ánh sáng chính ---
  scene.add(new THREE.HemisphereLight('#ffe6c4', '#2a1a10', 0.35));
  const sun = new THREE.DirectionalLight('#ffe2b0', 2.4);
  sun.position.set(-18, 17, -8);
  sun.target.position.set(1.5, 0, -12);
  scene.add(sun.target);
  if (SHADOWS) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048 * QUALITY, 2048 * QUALITY);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);
  const altarSpot = new THREE.SpotLight('#fff1d6', 160, 30, 0.42, 0.6, 1.4);
  altarSpot.position.set(0, 14, ALTAR_Z + 6);
  altarSpot.target.position.set(0, 3, HALL.back + 0.5);
  scene.add(altarSpot, altarSpot.target);
  const crossBackLight = new THREE.PointLight('#ffcf8a', 30, 9, 1.8);
  crossBackLight.position.set(0, CROSS_Y + 0.6, HALL.back + 1.2);
  scene.add(crossBackLight);

  // --- Tia nắng xiên qua kính màu bên trái ---
  const sunDir = new THREE.Vector3().subVectors(sun.target.position, sun.position).normalize();
  const shafts = [];
  windows
    // chỉ cửa bên trái (hứng nắng) và đủ xa camera — tia sát ống kính sẽ thành màn sương trắng
    .filter((w) => w.position.x < -7 && w.position.z < -6)
    .forEach((w) => {
      const len = 13;
      const geo = new THREE.CylinderGeometry(0.75, 1.35, len, 24, 1, true);
      const mat = makeShaftMaterial('#ffd7a0', 0.38);
      const shaft = new THREE.Mesh(geo, mat);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
      shaft.position.copy(w.position).addScaledVector(sunDir, len / 2);
      scene.add(shaft);
      shafts.push(shaft);
    });
  // Tia sáng toả từ cửa sổ hoa hồng xuống cung thánh
  const roseRay = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 4.2, 15, 32, 1, true), makeShaftMaterial('#ffe9c4', 0.2));
  const roseDir = new THREE.Vector3(0, -0.62, 1).normalize();
  roseRay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), roseDir);
  roseRay.position.copy(rose.position).addScaledVector(roseDir, 7.5);
  scene.add(roseRay);
  shafts.push(roseRay);

  // --- Bụi lơ lửng trong nắng ---
  const DUST = Math.round(700 * QUALITY);
  const dustPos = new Float32Array(DUST * 3);
  const dRand = mulberry32(9);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (dRand() - 0.5) * 13;
    dustPos[i * 3 + 1] = dRand() * 9;
    dustPos[i * 3 + 2] = HALL.back + 4 + dRand() * 32;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      map: textures.glow,
      color: '#ffe2b5',
      size: 0.06,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  scene.add(dust);

  // --- Hiệu ứng động: quả cầu ánh sáng cầu nguyện, trái tim "Amen", mưa sáng vàng ---
  const effects = [];
  const glowSpriteMat = (color, opacity = 1) =>
    new THREE.SpriteMaterial({ map: textures.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity });
  const heartMat = new THREE.SpriteMaterial({ map: textures.heart, transparent: true, depthWrite: false });

  function randomPerson() {
    return people[Math.floor(Math.random() * people.length)];
  }

  function prayerOrb() {
    const p = randomPerson();
    if (p) {
      p.bowTarget = 1;
      setTimeout(() => (p.bowTarget = 0), 6500);
    }
    const start = new THREE.Vector3(p ? p.x : 0, 1.6, p ? p.z : -10);
    const end = new THREE.Vector3(0, CROSS_Y + 0.6, HALL.back + 0.8);
    const ctrl = new THREE.Vector3((start.x + end.x) / 2, 9.5, (start.z + end.z) / 2);
    const s = new THREE.Sprite(glowSpriteMat('#fff0c8'));
    s.scale.setScalar(0.6);
    scene.add(s);
    effects.push({
      sprite: s,
      t: 0,
      dur: 5.2,
      update(e, dt) {
        e.t += dt;
        const k = Math.min(1, e.t / e.dur);
        const a = 1 - k;
        s.position.set(
          a * a * start.x + 2 * a * k * ctrl.x + k * k * end.x,
          a * a * start.y + 2 * a * k * ctrl.y + k * k * end.y,
          a * a * start.z + 2 * a * k * ctrl.z + k * k * end.z
        );
        s.scale.setScalar(0.6 + Math.sin(e.t * 6) * 0.08 + k * 0.4);
        s.material.opacity = Math.min(1, e.t * 2) * (k > 0.92 ? (1 - k) / 0.08 : 1);
        if (k >= 1) {
          flare(0.55);
          return false;
        }
        return true;
      }
    });
  }

  function amenHearts(count = 3) {
    const n = Math.max(1, Math.min(12, count));
    for (let i = 0; i < n; i++) {
      const p = randomPerson();
      if (!p) return;
      const s = new THREE.Sprite(heartMat.clone());
      const base = new THREE.Vector3(p.x, 1.6, p.z);
      s.scale.setScalar(0.32);
      s.position.copy(base);
      scene.add(s);
      const drift = (Math.random() - 0.5) * 0.6;
      effects.push({
        sprite: s,
        t: -i * 0.18,
        dur: 3.4,
        update(e, dt) {
          e.t += dt;
          if (e.t < 0) {
            s.visible = false;
            return true;
          }
          s.visible = true;
          const k = e.t / e.dur;
          s.position.set(base.x + Math.sin(e.t * 3) * 0.15 + drift * k, base.y + k * 3.2, base.z);
          s.material.opacity = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
          return k < 1;
        }
      });
    }
  }

  function goldenRain() {
    for (let i = 0; i < 70; i++) {
      const s = new THREE.Sprite(glowSpriteMat(i % 3 ? '#ffd56b' : '#fff6d8'));
      const x = (Math.random() - 0.5) * 12;
      const z = ALTAR_Z + 2 - Math.random() * 22;
      const y0 = 10 + Math.random() * 4;
      const sz = 0.08 + Math.random() * 0.14;
      s.scale.setScalar(sz);
      scene.add(s);
      effects.push({
        sprite: s,
        t: -Math.random() * 2,
        dur: 4 + Math.random() * 2,
        update(e, dt) {
          e.t += dt;
          if (e.t < 0) {
            s.visible = false;
            return true;
          }
          s.visible = true;
          const k = e.t / e.dur;
          s.position.set(x + Math.sin(e.t * 2 + x) * 0.3, y0 - k * y0, z);
          s.material.opacity = 1 - k;
          return k < 1;
        }
      });
    }
  }

  // Bừng sáng: hào quang thập tự, cửa sổ hoa hồng, tia sáng
  let flareLevel = 0;
  function flare(k = 0.6) {
    // Nhiều sự kiện liền nhau không được cộng dồn tới mức cháy sáng
    flareLevel = Math.min(1, flareLevel + k * (1 - flareLevel * 0.6));
  }
  let litCandles = 0;
  function setCandles(n) {
    litCandles = Math.max(0, Math.min(candleSlots.length, Math.round(n)));
    standFlames.forEach((f, i) => (f.visible = i < litCandles));
  }
  function bell() {
    flare(0.75);
    people.forEach((p) => {
      if (Math.random() < 0.35) {
        p.bowTarget = 0.7;
        setTimeout(() => (p.bowTarget = 0), 3200 + Math.random() * 1500);
      }
    });
  }
  function hallelujah() {
    flare(1.4);
    goldenRain();
    people.forEach((p) => {
      p.bowTarget = 0.5;
      setTimeout(() => (p.bowTarget = 0), 4000);
    });
  }

  // --- Hậu kỳ ---
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(RW, RH);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(RW / 2, RH / 2), BLOOM, 0.55, 0.78);
  composer.addPass(bloomPass);
  const vignette = new ShaderPass(VignetteShader);
  composer.addPass(vignette);
  composer.addPass(new OutputPass());

  // --- Camera trôi chậm (dolly) — chu kỳ dài để cảm nhận chiều sâu mà không gây chóng mặt ---
  function placeCamera(t) {
    const x = Math.sin((t * Math.PI * 2) / 52) * 0.75;
    const y = 2.55 + Math.sin((t * Math.PI * 2) / 33) * 0.1;
    const z = -1.2 + Math.sin((t * Math.PI * 2) / 71) * 0.9;
    camera.position.set(x, y, z);
    camera.lookAt(LOOK.x + x * 0.25, LOOK.y, LOOK.z);
  }

  // Chiếu 1 điểm 3D lên toạ độ khung 1080×1920 (để gắn thẻ tên HTML)
  const projV = new THREE.Vector3();
  function projectToStage(v) {
    projV.copy(v).project(camera);
    return {
      x: (projV.x * 0.5 + 0.5) * STAGE_W,
      y: (-projV.y * 0.5 + 0.5) * STAGE_H,
      visible: projV.z < 1
    };
  }
  const vipSeats = vipSeatIdx.map((i) => seats[i]); // đúng thứ tự hạng 1..6
  function vipAnchors() {
    return vipSeats.map((s) => projectToStage(new THREE.Vector3(s.x, 1.62, s.z)));
  }
  const standAnchor = () => projectToStage(new THREE.Vector3().copy(STAND).add(new THREE.Vector3(0, 2.0, 0)));
  const crossAnchor = () => projectToStage(new THREE.Vector3(0, CROSS_Y + 0.6, HALL.back + 0.5));

  // --- Vòng lặp vẽ ---
  const clock = new THREE.Clock();
  let last = 0;
  let elapsed = 0;
  let running = true;
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    canvas.dispatchEvent(new CustomEvent('church3d-lost'));
  });

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (lost) return;
    if (now - last < 1000 / FPS - 2) return;
    const dt = Math.min(0.3, clock.getDelta());
    last = now;
    elapsed += dt;
    const t = CAM_T != null ? CAM_T : elapsed;
    placeCamera(t);

    flareLevel = Math.max(0, flareLevel - dt * 0.45);
    const f = flareLevel;
    crossGlow.material.opacity = 0.5 + f * 0.3 + Math.sin(elapsed * 0.8) * 0.04;
    crossGlow.scale.setScalar(9 + f * 3);
    crossBackLight.intensity = 30 + f * 45;
    roseMat.color.setScalar(2.2 + f * 1.2);
    for (const w of windows) w.material.color.setScalar(w.userData.base * (1 + f * 0.2));
    for (const s of shafts) {
      s.material.uniforms.uTime.value = elapsed;
      s.material.uniforms.uStrength.value = (s === roseRay ? 0.2 : 0.38) * (1 + f * 0.7);
    }
    bloomPass.strength = BLOOM * (1 + f * 0.3);
    vignette.uniforms.uTime.value = elapsed % 100;

    // Ngọn lửa lập loè
    for (const fl of flames) {
      const n = Math.sin(elapsed * 9 + fl.userData.phase) * 0.08 + Math.sin(elapsed * 23 + fl.userData.phase) * 0.05;
      fl.scale.set(fl.userData.base * 0.5 * (1 + n), fl.userData.base * (1 + n * 1.5), 1);
    }
    for (let i = 0; i < litCandles; i++) {
      const fl = standFlames[i];
      const n = Math.sin(elapsed * 10 + fl.userData.phase) * 0.12 + Math.sin(elapsed * 27 + fl.userData.phase) * 0.06;
      fl.scale.set(0.065 * (1 + n), 0.13 * (1 + n * 1.4), 1);
    }
    const flick = 1 + Math.sin(elapsed * 7.3) * 0.06 + Math.sin(elapsed * 13.1) * 0.04;
    standLight.intensity = litCandles * 0.55 * flick;
    standGlow.material.opacity = Math.min(0.75, litCandles / 36) * 0.8 * flick;
    chandelierLights.forEach((l, i) => (l.intensity = 26 + Math.sin(elapsed * 0.7 + i) * 1.5));

    // Bụi trôi chậm
    const pos = dust.geometry.attributes.position;
    for (let i = 0; i < DUST; i++) {
      let y = pos.array[i * 3 + 1] + dt * 0.05 * (0.5 + ((i * 7) % 10) / 10);
      if (y > 9) y = 0.2;
      pos.array[i * 3 + 1] = y;
      pos.array[i * 3] += Math.sin(elapsed * 0.3 + i) * dt * 0.02;
    }
    pos.needsUpdate = true;

    updatePeople(elapsed);
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      if (!e.update(e, dt)) {
        scene.remove(e.sprite);
        if (e.sprite.material !== heartMat) e.sprite.material.dispose();
        effects.splice(i, 1);
      }
    }
    composer.render(dt);
    if (api.onFrame) api.onFrame();
  }
  requestAnimationFrame(frame);

  const api = {
    renderer,
    setCandles,
    prayerOrb,
    amenHearts,
    bell,
    hallelujah,
    flare,
    vipAnchors,
    standAnchor,
    crossAnchor,
    onFrame: null,
    stop() {
      running = false;
    },
    get stats() {
      return { people: people.length, pews: PEW_ROWS * 2, candles: litCandles, effects: effects.length, drawCalls: renderer.info.render.calls };
    }
  };
  window.Church3D = api;
  return api;
}
