/**
 * Depth3D — Nền Chánh Điện "3D chân thực" (2.5D parallax bằng WebGL)
 *
 * Nguyên lý:
 *  - Ảnh nền + bản đồ chiều sâu (depth map) => mỗi điểm ảnh biết mình xa/gần bao nhiêu.
 *  - Một "camera ảo" trôi rất chậm (lắc ngang, nâng hạ, tiến lùi). Điểm GẦN dịch nhiều,
 *    điểm XA dịch ít => mắt người cảm nhận chiều sâu thật (thị sai chuyển động).
 *  - Thêm ánh sáng: bloom (quầng sáng) + đèn lồng lập lòe + tia sáng thể tích (god rays)
 *    từ hào quang, chỉnh màu điện ảnh và vignette (tối 4 góc).
 *  - Các lớp HTML (Phật tử, đệm quỳ, lư hương...) được đăng ký vào cùng camera theo
 *    chiều sâu của chúng => di chuyển KHỚP với nền, không bị "trôi" khỏi sàn.
 *
 * Tham số URL:
 *   ?fx3d=0         Tắt hoàn toàn, quay về ảnh tĩnh gốc.
 *   ?depth=1.0      Cường độ chuyển động 3D (0 – 2). Mặc định 1.
 *   ?light=1.0      Cường độ ánh sáng (bloom + tia sáng). Mặc định 1.
 *   ?q=1            Tỉ lệ độ phân giải WebGL (0.5 – 1). Máy yếu dùng 0.75.
 *   ?fps=30         Giới hạn khung hình (mặc định 30, đủ mượt cho TikTok Live).
 *   ?camt=12.5      Đóng băng camera tại thời điểm (giây) — để chụp ảnh kiểm tra.
 *
 * Hằng số hình học phải khớp với tools/build_3d_assets.py.
 */
(function () {
  const STAGE_W = 1080;
  const STAGE_H = 1920;
  const SRC_H = 1672;
  const FLOOR_HORIZON_Y = (860 / SRC_H) * STAGE_H; // ~987.6px trên khung 1080x1920
  const FOCUS_DEPTH = 0.25; // mặt phẳng hội tụ = bàn thờ / đệm quỳ => vùng này gần như đứng yên

  const params = new URLSearchParams(window.location.search);
  const clampNum = (v, def, lo, hi) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  const ENABLED = params.get('fx3d') !== '0';
  const MOTION = clampNum(params.get('depth'), 1, 0, 2);
  const LIGHT = clampNum(params.get('light'), 1, 0, 2);
  const QUALITY = clampNum(params.get('q'), 1, 0.4, 1);
  const FPS = clampNum(params.get('fps'), 30, 10, 60);
  // ?camt=12.5 => đóng băng camera tại giây thứ 12.5 (dùng để kiểm tra / chụp ảnh so sánh)
  const FROZEN_T = params.has('camt') ? clampNum(params.get('camt'), 0, 0, 1e6) : null;

  /** Chiều sâu (disparity 0..1) của một điểm trên SÀN theo toạ độ y khung 1080x1920 */
  function floorDepth(yStage) {
    return Math.max(0, Math.min(1, (yStage - FLOOR_HORIZON_Y) / (STAGE_H - FLOOR_HORIZON_Y)));
  }

  // Camera ảo: tổng các sóng sin có chu kỳ lệch nhau => chuyển động tự nhiên, không lặp lộ liễu
  function cameraAt(tSec) {
    const TAU = Math.PI * 2;
    const m = MOTION;
    return {
      x: m * (0.0105 * Math.sin((TAU * tSec) / 41) + 0.0035 * Math.sin((TAU * tSec) / 17.3 + 1.1)),
      y: m * (0.0045 * Math.sin((TAU * tSec) / 29.7 + 0.6)),
      z: m * (0.028 * (0.5 + 0.5 * Math.sin((TAU * tSec) / 53 - 1.4)))
    };
  }

  // -------------------------------------------------------------------------
  // Đăng ký lớp HTML theo chiều sâu
  // -------------------------------------------------------------------------
  const layers = new Map(); // key -> { el, depth: number | () => number }
  let cam = { x: 0, y: 0, z: 0 };

  function resolveDepth(entry) {
    return typeof entry.depth === 'function' ? entry.depth() : entry.depth;
  }

  function applyLayer(entry, d) {
    if (!Number.isFinite(d)) return;
    const k = d - FOCUS_DEPTH;
    const tx = cam.x * k * STAGE_W;
    const ty = cam.y * k * STAGE_H;
    const s = 1 + cam.z * k;
    entry.el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(5)})`;
  }

  function setLayer(key, el, depth) {
    if (!el) {
      layers.delete(key);
      return;
    }
    el.classList.add('depth-layer');
    const entry = { el, depth };
    layers.set(key, entry);
    if (ENABLED) applyLayer(entry, resolveDepth(entry));
  }

  function removeLayer(key) {
    layers.delete(key);
  }

  const depthScratch = [];
  function updateLayers() {
    // Đọc hết (có thể đo vị trí phần tử) TRƯỚC, rồi mới ghi transform => tránh tính lại bố cục nhiều lần/khung hình
    depthScratch.length = 0;
    for (const [key, entry] of layers) {
      if (!entry.el.isConnected) {
        layers.delete(key);
        continue;
      }
      depthScratch.push(entry, resolveDepth(entry));
    }
    for (let i = 0; i < depthScratch.length; i += 2) {
      applyLayer(depthScratch[i], depthScratch[i + 1]);
    }
  }

  // -------------------------------------------------------------------------
  // WebGL renderer
  // -------------------------------------------------------------------------
  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uColor;
    uniform sampler2D uDepth;
    uniform sampler2D uGlow;
    uniform sampler2D uRays;
    uniform vec3 uCam;      // x, y: dịch ngang/dọc (đơn vị uv); z: tiến lùi
    uniform float uFocus;
    uniform float uTime;
    uniform float uLight;
    uniform float uHalo;    // tăng sáng khi có Đại Lễ / thỉnh chuông
    uniform vec2 uTexel;

    vec2 displacement(vec2 uv, float d) {
      float k = d - uFocus;
      return uCam.xy * k + (uv - 0.5) * uCam.z * k;
    }

    void main() {
      // Ánh xạ ngược: tìm toạ độ ảnh gốc mà sau khi dịch thị sai rơi đúng vào pixel này
      vec2 uv = vUv;
      for (int i = 0; i < 4; i++) {
        float d = texture2D(uDepth, uv).r;
        uv = vUv - displacement(uv, d);
      }
      uv = clamp(uv, uTexel, 1.0 - uTexel);

      // Làm nét nhẹ (ảnh gốc 941px được phóng lên 1080px)
      vec3 c = texture2D(uColor, uv).rgb;
      vec3 n = texture2D(uColor, uv + vec2(uTexel.x, 0.0)).rgb
             + texture2D(uColor, uv - vec2(uTexel.x, 0.0)).rgb
             + texture2D(uColor, uv + vec2(0.0, uTexel.y)).rgb
             + texture2D(uColor, uv - vec2(0.0, uTexel.y)).rgb;
      vec3 col = clamp(c + (c * 4.0 - n) * 0.22, 0.0, 1.0);

      // Đèn lồng / nến lập lòe: nhiễu tần số thấp theo vùng không gian
      float flick = 0.82
        + 0.10 * sin(uTime * 2.3 + uv.x * 23.0) * sin(uTime * 1.7 + uv.y * 17.0)
        + 0.06 * sin(uTime * 7.1 + uv.y * 41.0 + uv.x * 13.0);
      vec3 glow = texture2D(uGlow, uv).rgb;
      col += glow * (0.55 * flick + 0.35 * uHalo) * uLight;

      // Tia sáng thể tích: vân sáng chậm rãi xoay quanh tâm hào quang (như bụi & khói hương)
      vec2 src = vec2(0.4995, 0.1794);
      vec2 dv = (vUv - src) * vec2(1.0, 1.777);
      float ang = atan(dv.y, dv.x);
      float shafts = 0.55 + 0.45 * sin(ang * 23.0 + uTime * 0.21 + 2.0 * sin(ang * 7.0 - uTime * 0.13));
      shafts *= 0.75 + 0.25 * sin(length(dv) * 18.0 - uTime * 0.6);
      vec3 rays = texture2D(uRays, vUv).rgb;
      col += rays * shafts * (0.30 + 0.45 * uHalo) * uLight;

      // Chỉnh màu điện ảnh: tương phản chữ S nhẹ + vùng sáng ấm, vùng tối hơi lạnh
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += (vec3(1.0, 0.93, 0.80) - 1.0) * (1.0 - l) * 0.06;
      col *= mix(vec3(0.97, 0.98, 1.03), vec3(1.03, 1.0, 0.95), smoothstep(0.2, 0.8, l));

      // Vignette (tối dần 4 góc) giúp mắt tập trung vào Đức Phật
      vec2 q = (vUv - vec2(0.5, 0.42)) * vec2(1.0, 0.72);
      col *= 1.0 - 0.42 * pow(clamp(length(q) * 1.35, 0.0, 1.0), 2.4);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Không tải được ${src}`));
      img.src = src;
    });
  }

  function compile(gl, type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`Shader lỗi: ${log}`);
    }
    return sh;
  }

  function makeTexture(gl, img) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  const state = {
    ready: false,
    haloBoost: 0, // 0..1, giảm dần theo thời gian
    startMs: performance.now()
  };

  async function initRenderer(canvas, fallbackImg) {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('Trình duyệt không hỗ trợ WebGL');

    const base = '/assets/';
    const [color, depth, glow, rays] = await Promise.all([
      loadImage(fallbackImg?.getAttribute('src') || `${base}amitabha_stage.png`),
      loadImage(`${base}3d/amitabha_depth.png`),
      loadImage(`${base}3d/amitabha_glow.jpg`),
      loadImage(`${base}3d/amitabha_rays.jpg`)
    ]);

    canvas.width = Math.round(STAGE_W * QUALITY);
    canvas.height = Math.round(STAGE_H * QUALITY);

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Link shader lỗi: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const textures = [color, depth, glow, rays].map((img) => makeTexture(gl, img));
    ['uColor', 'uDepth', 'uGlow', 'uRays'].forEach((name, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, textures[i]);
      gl.uniform1i(gl.getUniformLocation(prog, name), i);
    });

    const u = {
      cam: gl.getUniformLocation(prog, 'uCam'),
      focus: gl.getUniformLocation(prog, 'uFocus'),
      time: gl.getUniformLocation(prog, 'uTime'),
      light: gl.getUniformLocation(prog, 'uLight'),
      halo: gl.getUniformLocation(prog, 'uHalo'),
      texel: gl.getUniformLocation(prog, 'uTexel')
    };
    gl.uniform1f(u.focus, FOCUS_DEPTH);
    gl.uniform1f(u.light, LIGHT);
    gl.uniform2f(u.texel, 1 / color.naturalWidth, 1 / color.naturalHeight);
    gl.viewport(0, 0, canvas.width, canvas.height);

    return function draw(tSec) {
      gl.uniform3f(u.cam, cam.x, cam.y, cam.z);
      gl.uniform1f(u.time, tSec);
      gl.uniform1f(u.halo, state.haloBoost);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }

  async function start() {
    const canvas = document.getElementById('depth3dCanvas');
    const fallbackImg = document.querySelector('.sanctuary-bg-img');
    if (!ENABLED || !canvas) {
      if (canvas) canvas.style.display = 'none';
      return;
    }

    let draw = null;
    try {
      draw = await initRenderer(canvas, fallbackImg);
    } catch (err) {
      console.warn('[Depth3D] Không bật được nền 3D, dùng ảnh tĩnh:', err.message);
      canvas.style.display = 'none';
      return;
    }

    // Mất ngữ cảnh GPU (driver reset, OBS đổi scene...) => hiện lại ảnh tĩnh rồi khởi tạo lại
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      draw = null;
      document.body.classList.remove('fx3d-on');
      console.warn('[Depth3D] Mất ngữ cảnh WebGL, chờ khôi phục...');
    });
    canvas.addEventListener('webglcontextrestored', async () => {
      try {
        draw = await initRenderer(canvas, fallbackImg);
        document.body.classList.add('fx3d-on');
      } catch (err) {
        console.warn('[Depth3D] Khôi phục thất bại:', err.message);
      }
    });

    document.body.classList.add('fx3d-on');
    state.ready = true;

    const frameMs = 1000 / FPS;
    let last = 0;
    function loop(now) {
      requestAnimationFrame(loop);
      if (now - last < frameMs - 1) return;
      const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
      last = now;
      const t = (now - state.startMs) / 1000;
      cam = cameraAt(FROZEN_T ?? t);
      state.haloBoost = Math.max(0, state.haloBoost - dt * 0.35);
      if (draw) draw(t);
      updateLayers();
    }
    requestAnimationFrame(loop);
  }

  window.Depth3D = {
    enabled: ENABLED,
    focusDepth: FOCUS_DEPTH,
    floorDepth,
    setLayer,
    removeLayer,
    /** Bùng sáng hào quang/tia sáng (0..1) — dùng khi thỉnh chuông, Đại Lễ */
    flare(amount = 1) {
      state.haloBoost = Math.min(1, Math.max(state.haloBoost, amount));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
