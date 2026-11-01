/**
 * Live 9:16 Client Controller — Chánh Điện Đức Phật A Di Đà & Đạo Tràng Phật Tử Quỳ Lễ
 * - Hiển thị 6 Đệm Quỳ VIP (Top 6 Bảng Vàng Công Đức)
 * - Hiển thị 40 Phật Tử mặc áo lam quỳ hai bên thảm đỏ + thẻ tên người xem
 * - Hiệu ứng người xem bước dọc thảm đỏ lên trước Lư Hương Đồng dâng hương
 * - Giọng đọc ZeroTTS (Mai Chi) + Pháp khí Web Audio
 */
(function () {
  const params = new URLSearchParams(window.location.search);

  // 0. Gói câu chữ của phòng (server nạp qua /api/pack.js). Thiếu khoá nào => dùng tiếng Việt mặc định.
  const PACK = window.ROOM_PACK || { ui: {}, meta: { numberLocale: 'vi-VN' }, tts: { voice: 'maichi' } };
  const UI = PACK.ui || {};
  const NUM_LOCALE = PACK.meta?.numberLocale || 'vi-VN';
  const DEFAULT_VOICE = PACK.tts?.voice || 'maichi';
  const fmt = (n) => Number(n || 0).toLocaleString(NUM_LOCALE);
  // T('actIncense', 'mặc định {count}', { count: 3 }) => thay {biến}
  function T(key, fallback, vars = {}) {
    const tpl = UI[key] != null ? String(UI[key]) : fallback;
    return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
  }
  if (PACK.meta?.htmlLang) document.documentElement.lang = PACK.meta.htmlLang;
  if (UI.pageTitle) document.title = UI.pageTitle;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (UI[key] != null) el.textContent = UI[key];
  });
  if (PACK.locale && PACK.locale !== 'vi') document.body.classList.add(`lang-${PACK.locale}`);
  if (UI.lanternLabel) document.documentElement.style.setProperty('--lantern-label', JSON.stringify(UI.lanternLabel));

  // Đồng hồ theo múi giờ của phòng (vd. Seoul) + buổi lễ kế tiếp — chỉ hiện khi gói có lịch lễ
  const ROOM_TZ = PACK.meta?.timeZone || undefined;
  function zonedClock(date = new Date()) {
    const parts = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: ROOM_TZ, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' })
        .formatToParts(date)
        .forEach((p) => (parts[p.type] = p.value));
    } catch (_) {}
    const hh = parts.hour === '24' ? '00' : parts.hour || '00';
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday] ?? 0;
    return { time: `${hh}:${parts.minute || '00'}`, weekday: wd };
  }
  function nextScheduleItem() {
    const list = Array.isArray(PACK.schedule) ? PACK.schedule : [];
    if (!list.length) return null;
    const now = zonedClock();
    const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const nowMin = toMin(now.time);
    let best = null;
    for (let dayOffset = 0; dayOffset < 8 && !best; dayOffset++) {
      const wd = (now.weekday + dayOffset) % 7;
      const candidates = list
        .filter((it) => !Array.isArray(it.days) || it.days.includes(wd))
        .filter((it) => dayOffset > 0 || toMin(it.time) > nowMin)
        .sort((a, b) => toMin(a.time) - toMin(b.time));
      if (candidates.length) best = candidates[0];
    }
    return best;
  }
  const clockEl = document.getElementById('roomClock');
  function renderClock() {
    if (!clockEl) return;
    const next = nextScheduleItem();
    if (!next) {
      clockEl.hidden = true;
      return;
    }
    clockEl.hidden = false;
    clockEl.textContent = `🕰 ${T('clockLabel', '')} ${zonedClock().time} · ${next.title} ${next.time}`.replace(/\s+/g, ' ');
  }
  renderClock();
  setInterval(renderClock, 15 * 1000);

  if (params.get('obs') === '1') {
    document.body.classList.add('obs-mode');
  }

  // 1. Tự động co giãn khung 1080x1920 vừa khít Stage Wrapper (9:16)
  const stageWrapper = document.getElementById('stageWrapper');
  const stage9x16 = document.getElementById('stage9x16');

  function fitStage() {
    if (!stageWrapper || !stage9x16) return;
    const rect = stageWrapper.getBoundingClientRect();
    const scale = rect.width / 1080;
    stage9x16.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  // 1B. Chế độ 3D chân thực: gắn các lớp HTML vào cùng camera thị sai với nền WebGL
  const Depth3D = window.Depth3D || {
    enabled: false,
    floorDepth: () => 0.5,
    setLayer() {},
    flare() {}
  };
  // Bóng đổ: nguồn sáng chính là bàn thờ (giữa, phía trước nhân vật) => bóng hắt về phía
  // người xem và xiên ra ngoài theo khoảng cách so với trục giữa Chánh Điện.
  function shadowSkewStyle(x) {
    const skew = Math.max(-38, Math.min(38, ((540 - x) / 540) * 38));
    return `--shadow-skew: ${skew.toFixed(1)}deg;`;
  }

  // Đa dạng hoá Đạo Tràng: không ai giống hệt ai (áo lam / áo nâu / áo xám tro, quay trái/phải)
  const ROBE_TONES = [
    'brightness(1)',
    'sepia(0.5) hue-rotate(-12deg) saturate(1.15) brightness(0.92)',
    'brightness(1)',
    'saturate(0.35) brightness(0.97)'
  ];
  function figureVariant(idx) {
    const h = (idx * 2654435761) >>> 0; // băm số nguyên đơn giản, cố định theo vị trí ghế
    return {
      tone: ROBE_TONES[h % ROBE_TONES.length],
      flip: ((h >>> 3) & 1) === 1
    };
  }

  // Bục gỗ đặt đệm quỳ cao hơn sàn => chiều sâu không nhỏ hơn mặt bục (0.26)
  const PLATFORM_DEPTH = 0.26;
  const groundDepthAt = (yStage) => Math.max(PLATFORM_DEPTH, Depth3D.floorDepth(yStage));

  document.querySelectorAll('.depth-wrap[data-depth]').forEach((el) => {
    Depth3D.setLayer(el.id, el, parseFloat(el.dataset.depth));
  });
  // Chủ lễ đi từ cuối thảm đỏ lên bàn thờ => chiều sâu thay đổi theo vị trí chân
  (function registerCentralLayer() {
    const layer = document.getElementById('depthCentralLayer');
    const stack = document.getElementById('centralSpriteStack');
    if (!layer || !stack) return;
    Depth3D.setLayer('central', layer, () => {
      const stageRect = stage9x16.getBoundingClientRect();
      const k = stageRect.height / 1920 || 1;
      const footY = (stack.getBoundingClientRect().bottom - stageRect.top) / k;
      return groundDepthAt(footY);
    });
  })();

  // 2. Khởi tạo Particle Engine & Audio Engine (ZeroTTS Mai Chi)
  const canvas = document.getElementById('templeCanvas');
  const particles = new window.TempleParticleEngine(canvas);
  const audio = new window.TempleAudioEngine();

  function unlockAudioOnce() {
    audio.ensureContext();
    const btnUnlock = document.getElementById('btnUnlockAudio');
    if (btnUnlock) {
      btnUnlock.textContent = '✅ Âm Thanh Chùa Đã Sẵn Sàng';
      btnUnlock.classList.remove('gold');
      btnUnlock.classList.add('active-toggle');
    }
  }
  window.addEventListener('pointerdown', unlockAudioOnce, { once: true });

  // 3. Vẽ các nén nhang đang cháy trong Lư Hương Đỉnh Đồng (x=540, y=895)
  const incenseHolder = document.getElementById('incenseSticksHolder');
  let renderedStickCount = 0;

  function renderIncenseSticks(count) {
    const target = Math.max(3, Math.min(27, Number(count) || 9));
    if (target === renderedStickCount && incenseHolder.children.length > 0) return;
    renderedStickCount = target;
    incenseHolder.innerHTML = '';

    const tips = [];
    for (let i = 0; i < target; i++) {
      const stick = document.createElement('div');
      stick.className = 'incense-stick';

      const spread = target === 1 ? 0 : (i / (target - 1) - 0.5) * 2;
      const leftPx = 65 + spread * 28 + Math.sin(i * 2.1) * 2;
      const angleDeg = spread * 12 + Math.cos(i * 1.5) * 1.5;
      const heightPx = 76 + (i % 3) * 6;

      stick.style.left = `${leftPx}px`;
      stick.style.height = `${heightPx}px`;
      stick.style.transform = `rotate(${angleDeg}deg)`;

      const ember = document.createElement('div');
      ember.className = 'incense-ember';
      ember.style.animationDelay = `${(i * 0.15) % 1.1}s`;
      stick.appendChild(ember);
      incenseHolder.appendChild(stick);

      const rad = (angleDeg * Math.PI) / 180;
      const tipX = 540 + (leftPx - 65) + Math.sin(rad) * heightPx;
      const tipY = 895 - Math.cos(rad) * heightPx;
      tips.push({ x: tipX, y: tipY });
    }
    particles.setIncenseTips(tips);
  }

  // 4. Dựng Hàng 6 Đệm Quỳ VIP (Top 6 Thí Chủ trên bục gỗ y=1188)
  const VIP_CUSHION_COORDS = [
    { x: 140, y: 1188, rank: 1 },
    { x: 268, y: 1188, rank: 2 },
    { x: 392, y: 1188, rank: 3 },
    { x: 688, y: 1188, rank: 4 },
    { x: 812, y: 1188, rank: 5 },
    { x: 940, y: 1188, rank: 6 }
  ];

  function renderVipCushions(leaderboard = []) {
    const layer = document.getElementById('vipCushionsLayer');
    if (!layer) return;

    layer.innerHTML = VIP_CUSHION_COORDS.map((slot, idx) => {
      const dev = leaderboard[idx];
      if (!dev) return '';
      return `
        <div class="vip-devotee-slot" style="left: ${slot.x}px; top: ${slot.y}px; z-index: ${12 + idx};">
          <div class="figure3d" style="animation-delay: -${(idx * 0.9).toFixed(1)}s; ${shadowSkewStyle(slot.x)}">
            <img src="/assets/3d/devotee.png" alt="" class="figure-shadow" aria-hidden="true" />
            <img src="/assets/3d/devotee.png" alt="VIP Devotee" class="devotee-sprite${figureVariant(idx + 7).flip ? ' flip' : ''}" style="--robe-tone: ${figureVariant(idx + 7).tone};" />
          </div>
          <div class="vip-rank-pill">
            <span class="vip-rank-num">${slot.rank}</span>
            <span class="vip-rank-name">${escapeHtml(shortenName(dev.name, 12))}</span>
          </div>
        </div>
      `;
    }).join('');
    Depth3D.setLayer('vip', layer, PLATFORM_DEPTH);
  }

  // 5. Dựng Đạo Tràng 40 Phật Tử Quỳ Lễ Hai Bên Thảm Đỏ (5 Hàng x 4 Cột mỗi bên)
  const congregationHall = document.getElementById('congregationHall');
  const HALL_SEAT_COORDS = [];

  (function buildHallGrid() {
    const rows = 5;
    const colsPerSide = 4;
    for (let r = 0; r < rows; r++) {
      const progress = r / (rows - 1); // 0 (xa) -> 1 (gần)
      const y = Math.round(1290 + progress * 355); // 1290 -> 1645
      const scale = +(0.76 + progress * 0.28).toFixed(2);

      // Cánh trái thảm đỏ
      const leftInnerX = Math.round(335 - progress * 48); // mép thảm mở rộng dần
      const leftOuterX = 48;
      for (let c = 0; c < colsPerSide; c++) {
        const t = c / (colsPerSide - 1);
        const x = Math.round(leftOuterX + t * (leftInnerX - leftOuterX));
        HALL_SEAT_COORDS.push({ side: 'L', row: r, col: c, x, y, scale });
      }

      // Cánh phải thảm đỏ
      const rightInnerX = Math.round(745 + progress * 48);
      const rightOuterX = 1032;
      for (let c = 0; c < colsPerSide; c++) {
        const t = c / (colsPerSide - 1);
        const x = Math.round(rightInnerX + t * (rightOuterX - rightInnerX));
        HALL_SEAT_COORDS.push({ side: 'R', row: r, col: c, x, y, scale });
      }
    }
  })();

  let lastRenderedLeaderboardJson = '';

  function renderCongregationHall(leaderboard = []) {
    if (!congregationHall) return;
    // Những người xếp từ hạng 7 trở đi ngồi ở các vị trí đầu tiên cạnh thảm đỏ
    const hallViewers = leaderboard.slice(6);
    const sig = JSON.stringify(hallViewers.map((d) => `${d.name}:${d.merit}`));
    if (sig === lastRenderedLeaderboardJson && congregationHall.children.length > 0) return;
    lastRenderedLeaderboardJson = sig;

    // Ưu tiên gắn thẻ tên vào các ghế gần thảm đỏ dễ nhìn nhất
    const labeledSeatIndices = [
      3, 4, 11, 12, 19, 20, 27, 28, 35, 36, 2, 5, 10, 13, 18, 21, 26, 29
    ];
    const seatViewerMap = new Map();
    hallViewers.forEach((viewer, idx) => {
      if (idx < labeledSeatIndices.length) {
        seatViewerMap.set(labeledSeatIndices[idx], viewer);
      }
    });

    const seatHtml = HALL_SEAT_COORDS.map((seat, idx) => {
      const viewer = seatViewerMap.get(idx);
      const badgeHtml = viewer
        ? `
          <div class="seat-badge">
            <span class="seat-avatar">${
              viewer.avatar
                ? `<img src="${escapeHtml(viewer.avatar)}" alt="" />`
                : escapeHtml(String(viewer.name || 'P').charAt(0).toUpperCase())
            }</span>
            <span class="seat-username">${escapeHtml(shortenName(viewer.name, 11))}</span>
          </div>
        `
        : '';

      return `
        <div
          class="hall-seat"
          data-seat-idx="${idx}"
          style="left: ${seat.x}px; top: ${seat.y}px; transform: translate(-50%, -100%) scale(${seat.scale});"
        >
          <div class="figure3d" style="animation-delay: -${((idx * 0.73) % 4.2).toFixed(2)}s; ${shadowSkewStyle(seat.x)}">
            <img src="/assets/3d/devotee.png" alt="" class="figure-shadow" aria-hidden="true" />
            <img
              src="/assets/3d/devotee.png"
              alt="Phật tử"
              class="devotee-sprite${figureVariant(idx).flip ? ' flip' : ''}"
              style="--robe-tone: ${figureVariant(idx).tone};"
            />
          </div>
          ${badgeHtml}
        </div>
      `;
    });

    // Mỗi hàng ghế là 1 lớp chiều sâu riêng: hàng xa dịch ít, hàng gần dịch nhiều khi camera trôi.
    // Hàng xa nhận thêm "phối cảnh không khí" (hơi mờ sương khói, giảm tương phản).
    const rowCount = Math.max(...HALL_SEAT_COORDS.map((s) => s.row)) + 1;
    let html = '';
    for (let r = 0; r < rowCount; r++) {
      const far = 1 - r / Math.max(1, rowCount - 1); // 1 = hàng xa nhất
      const haze = `brightness(${(0.9 + 0.1 * (1 - far)).toFixed(3)}) contrast(${(0.9 + 0.1 * (1 - far)).toFixed(3)}) saturate(${(0.88 + 0.12 * (1 - far)).toFixed(3)})`;
      const seats = HALL_SEAT_COORDS.map((seat, idx) => (seat.row === r ? seatHtml[idx] : '')).join('');
      html += `<div class="hall-row" data-row="${r}" style="z-index: ${20 + r * 2}; --row-haze: ${haze};">${seats}</div>`;
    }
    congregationHall.innerHTML = html;
    congregationHall.querySelectorAll('.hall-row').forEach((rowEl) => {
      const r = Number(rowEl.dataset.row);
      const seat = HALL_SEAT_COORDS.find((s) => s.row === r);
      Depth3D.setLayer(`hall-row-${r}`, rowEl, Depth3D.floorDepth(seat.y));
    });
  }

  // Preload toàn bộ 8 frame nhân vật vào bộ nhớ để chuyển frame mượt 0ms
  const SPRITE_FRAMES = {
    walk1: '/assets/3d/devotee_walk.png',
    walk2: '/assets/3d/devotee_walk_2.png',
    kneelDown: '/assets/3d/devotee_kneel_down.png',
    kneel: '/assets/3d/devotee.png',
    forehead: '/assets/3d/devotee_bow.png',
    bowMid: '/assets/3d/devotee_bow_mid.png',
    prostrate: '/assets/3d/devotee_prostrate.png',
    prostrateDeep: '/assets/3d/devotee_prostrate_deep.png'
  };
  Object.values(SPRITE_FRAMES).forEach((url) => {
    const img = new Image();
    img.src = url;
  });

  function pulseHallBowing() {
    if (!congregationHall) return;
    const seats = congregationHall.querySelectorAll('.hall-seat');
    seats.forEach((el, i) => {
      if (i % 4 !== 0) return;
      // Đổi khung hình cho cả nhân vật lẫn bóng đổ của nhân vật
      const imgs = el.querySelectorAll('img.devotee-sprite, img.figure-shadow');
      if (!imgs.length) return;
      const setSrc = (src) => imgs.forEach((img) => { img.src = src; });
      const delay = (i % 4) * 80;
      setTimeout(() => setSrc(SPRITE_FRAMES.forehead), delay);
      setTimeout(() => setSrc(SPRITE_FRAMES.bowMid), delay + 140);
      setTimeout(() => setSrc(SPRITE_FRAMES.prostrateDeep), delay + 300);
      setTimeout(() => setSrc(SPRITE_FRAMES.bowMid), delay + 620);
      setTimeout(() => setSrc(SPRITE_FRAMES.kneel), delay + 780);
    });
  }

  let prostrationTimers = [];
  function clearProstrationTimers() {
    while (prostrationTimers.length > 0) {
      clearTimeout(prostrationTimers.pop());
    }
  }

  // Chuyển đổi tức thời giữa 8 khung hình đã giải mã sẵn trên GPU (KHÔNG BAO GIỜ BỊ MẤT HÌNH)
  function setCentralPose(poseKey) {
    const stack = document.getElementById('centralSpriteStack');
    if (!stack) return;
    const frames = stack.querySelectorAll('.pose-frame');
    frames.forEach((img) => {
      img.classList.toggle('active', img.getAttribute('data-pose') === poseKey);
    });
  }

  function schedulePose(ms, poseKey) {
    prostrationTimers.push(
      setTimeout(() => {
        setCentralPose(poseKey);
      }, ms)
    );
  }

  // Chuỗi 8 khung hình Đảnh lễ Tam Bái mượt mà (Hạ gối -> Chắp tay ngực -> Đưa lên trán -> Nghiêng 45° -> Chống tay -> Lạy sát đất -> Ngẩng lên)
  function playThreeBowsSequence(startDelayMs = 0) {
    schedulePose(startDelayMs, 'kneelDown');
    schedulePose(startDelayMs + 160, 'kneel');

    const bowOffsets = [startDelayMs + 320, startDelayMs + 1820, startDelayMs + 3320];
    bowOffsets.forEach((t0) => {
      schedulePose(t0, 'forehead');            // 1. Chắp tay đưa lên trán
      schedulePose(t0 + 170, 'bowMid');        // 2. Cúi gập lưng 45°
      schedulePose(t0 + 330, 'prostrate');     // 3. Vươn hai tay chống xuống đệm
      schedulePose(t0 + 490, 'prostrateDeep'); // 4. Lạy sát đất (Ngũ thể đầu địa)
      schedulePose(t0 + 860, 'prostrate');     // 5. Bắt đầu nâng đầu lên
      schedulePose(t0 + 1020, 'bowMid');       // 6. Nâng lưng lên góc 45°
      schedulePose(t0 + 1180, 'kneel');        // 7. Ngồi quỳ thẳng lưng
    });

    schedulePose(startDelayMs + 4800, 'forehead');
    schedulePose(startDelayMs + 5350, 'kneel');
  }

  // Hiệu ứng thí chủ ĐỨNG ĐI BỘ từng bước dọc thảm đỏ rồi Hạ gối Quỳ Đảnh Lễ (trên cùng 1 nhân vật, không bao giờ mất hình)
  function animateWalkerOnCarpet(user, avatar, actionLabel, wish) {
    const centralEl = document.getElementById('centralWorshipper');
    if (!centralEl) return;

    clearProstrationTimers();
    updateCentralWorshipper(user, avatar, actionLabel, wish, false);

    // Khởi động bước đi từ cuối thảm đỏ lên chính điện
    centralEl.classList.remove('walking-up');
    void centralEl.offsetWidth;
    centralEl.classList.add('walking-up');

    setCentralPose('walk1');
    for (let step = 1; step <= 10; step++) {
      schedulePose(step * 185, step % 2 === 0 ? 'walk1' : 'walk2');
    }

    // Khi bước tới trước Lư Hương (2.05s): dừng bước, hạ gối quỳ xuống đệm và bắt đầu Đảnh lễ 3 lạy
    prostrationTimers.push(
      setTimeout(() => {
        centralEl.classList.remove('walking-up');
      }, 2100)
    );
    playThreeBowsSequence(2050);
  }

  function updateCentralWorshipper(user, avatar, actionLabel, wish, doThreeBows = true) {
    const nameEl = document.getElementById('centralName');
    const actEl = document.getElementById('centralAction');
    const wishEl = document.getElementById('centralWishBubble');
    const avatarEl = document.getElementById('centralAvatar');
    const beam = document.getElementById('sacredLightBeam');

    if (nameEl) nameEl.textContent = user || T('defaultName', 'Thí Chủ Hữu Duyên');
    if (actEl) actEl.textContent = actionLabel || T('defaultAction', '✨ Dâng hương cầu an');
    if (wishEl) wishEl.textContent = `“${wish || T('defaultWish', 'Nam Mô A Di Đà Phật, cầu bình an cát tường')}”`;

    if (avatarEl) {
      if (avatar) {
        avatarEl.innerHTML = `<img src="${escapeHtml(avatar)}" alt="" />`;
      } else {
        avatarEl.textContent = String(user || '🙏').trim().charAt(0).toUpperCase();
      }
    }

    if (doThreeBows) {
      clearProstrationTimers();
      const centralEl = document.getElementById('centralWorshipper');
      if (centralEl) centralEl.classList.remove('walking-up');
      playThreeBowsSequence(0);
    }
    if (beam) {
      beam.classList.add('intense');
      setTimeout(() => beam.classList.remove('intense'), 4500);
    }

    const haloSys = document.getElementById('buddhaHaloSystem');
    const lotusHand = document.getElementById('lotusHandHalo');
    if (haloSys) {
      haloSys.classList.add('flare');
      setTimeout(() => haloSys.classList.remove('flare'), 3600);
    }
    if (lotusHand) {
      lotusHand.classList.add('flare');
      setTimeout(() => lotusHand.classList.remove('flare'), 3600);
    }
    particles.spawnBellWave(540, 260, 2);
    Depth3D.flare(0.6);

    // Cập nhật dòng thông báo dưới thanh HUD
    const hudName = document.getElementById('devoteeNameLine');
    const hudAct = document.getElementById('devoteeActionTag');
    if (hudName) hudName.textContent = user || T('defaultName', 'Thí Chủ');
    if (hudAct) hudAct.textContent = actionLabel || T('cardIncense', 'Dâng hương');
  }

  // 6. Cập nhật toàn bộ giao diện theo State từ Server
  let hasInitializedRealLeader = false;

  function updateUIState(st) {
    if (!st) return;

    document.getElementById('statIncense').textContent = fmt(st.totalIncense);
    document.getElementById('statMerit').textContent = fmt(st.totalMerit);
    document.getElementById('statWoodenFish').textContent = fmt(st.woodenFishHits);

    renderIncenseSticks(st.activeIncenseSticks || 9);

    const lb = Array.isArray(st.leaderboard) ? st.leaderboard : [];
    renderVipCushions(lb);
    renderCongregationHall(lb);

    // Đồng bộ tên Chủ Lễ mặc định theo người dẫn đầu thực tế nếu chưa có sự kiện mới
    if (!hasInitializedRealLeader && lb.length > 0) {
      hasInitializedRealLeader = true;
      const topDev = lb[0];
      updateCentralWorshipper(
        topDev.name,
        topDev.avatar,
        T('leaderMerit', '✨ Công đức: {n} CĐ', { n: fmt(topDev.merit) }),
        topDev.lastWish || T('defaultWish', 'Nam Mô A Di Đà Phật, cầu bình an cát tường'),
        false
      );
    }

    // Cập nhật Bảng TẤM LÒNG THÀNH ở góc dưới phải (Top 4)
    const lbList = document.getElementById('leaderboardList');
    if (lbList) {
      lbList.innerHTML = lb
        .slice(0, 4)
        .map(
          (item) => `
          <div class="leader-item">
            <span class="leader-rank">${item.rank}</span>
            <span class="leader-name">${escapeHtml(shortenName(item.name, 14))}</span>
            <span class="leader-merit">${fmt(item.merit)}</span>
          </div>
        `
        )
        .join('');
    }

    // Trạng thái kết nối TikTok Live
    const liveDot = document.getElementById('liveDot');
    const liveText = document.getElementById('liveStatusText');
    if (st.tiktok?.connected) {
      liveDot.classList.add('connected');
      liveText.textContent = T('liveViewers', 'LIVE @{user} • {n} mắt', { user: st.tiktok.username, n: fmt(st.tiktok.viewerCount) });
    } else if (st.tiktok?.connecting) {
      liveDot.classList.remove('connected');
      liveText.textContent = T('connecting', 'Đang kết nối @{user}...', { user: st.tiktok.username });
    } else {
      liveDot.classList.remove('connected');
      liveText.textContent = st.settings?.autoSim
        ? T('brandSim', 'CHÙA LINH ỨNG • TỰ ĐỘNG GIẢ LẬP ĐÔNG NGƯỜI')
        : T('brand', 'CHÙA LINH ỨNG • ĐỨC PHẬT A DI ĐÀ');
    }

    const btnAutoSim = document.getElementById('btnToggleAutoSim');
    if (btnAutoSim && st.settings) {
      btnAutoSim.textContent = st.settings.autoSim
        ? '🤖 Tự động Giả lập Người Xem: ĐANG BẬT'
        : '🤖 Tự động Giả lập Người Xem: TẮT';
      btnAutoSim.classList.toggle('active-toggle', Boolean(st.settings.autoSim));
    }
    if (st.settings) {
      if (typeof st.settings.musicVolume === 'number') {
        audio.setMusicVolume(st.settings.musicVolume);
        const sMus = document.getElementById('sliderMusicVol');
        const vMus = document.getElementById('valMusicVol');
        const pct = Math.round(st.settings.musicVolume * 100);
        if (sMus) sMus.value = String(pct);
        if (vMus) vMus.textContent = `${pct}%`;
      }
      if (typeof st.settings.ttsVolume === 'number') {
        audio.setTtsVolume(st.settings.ttsVolume);
        const sTts = document.getElementById('sliderTtsVol');
        const vTts = document.getElementById('valTtsVol');
        const pct = Math.round(st.settings.ttsVolume * 100);
        if (sTts) sTts.value = String(pct);
        if (vTts) vTts.textContent = `${pct}%`;
      }
    }


    const feed = document.getElementById('eventFeed');
    if (feed && Array.isArray(st.recentEvents)) {
      feed.innerHTML = st.recentEvents
        .slice(0, 8)
        .map((ev) => `<div class="event-feed-item">${formatEventSummary(ev)}</div>`)
        .join('');
    }
  }

  function formatEventSummary(ev) {
    switch (ev.type) {
      case 'burnIncense':
        return `🔥 <strong>${escapeHtml(ev.user)}</strong> dâng ${ev.count} nén nhang (+${ev.merit} CĐ)`;
      case 'strikeWoodenFish':
        return `🪵 <strong>${escapeHtml(ev.user)}</strong> gõ mõ ${ev.count} nhịp (+${ev.merit} CĐ)`;
      case 'ringBell':
        return `🔔 <strong>${escapeHtml(ev.user)}</strong> thỉnh Đại Hồng Chung (+${ev.merit} CĐ)`;
      case 'sendPrayer':
        return `🏮 <strong>${escapeHtml(ev.user)}</strong> cầu phúc: “${escapeHtml(ev.wish)}”`;
      case 'offerGift':
      case 'grandCeremony':
        return `🪷 <strong>${escapeHtml(ev.user)}</strong> dâng <em>${escapeHtml(ev.giftName)}</em> (+${ev.merit} CĐ)`;
      case 'drawFortune':
        return `🎋 <strong>${escapeHtml(ev.user)}</strong> gieo được Quẻ số ${ev.fortune?.number} (${ev.fortune?.rank})`;
      case 'announce':
        return `🔔 Giờ lễ: <strong>${escapeHtml(ev.title || '')}</strong>`;
      case 'idleTalk':
        return `📿 Tự đọc khi phòng vắng${ev.card ? `: ${escapeHtml(ev.card.rank)}` : ''}`;
      case 'welcome':
        return `💛 Chào người theo dõi: <strong>${escapeHtml((ev.names || [ev.user]).join(', '))}</strong>`;
      default:
        return `✨ <strong>${escapeHtml(ev.user || 'Thí chủ')}</strong> tương tác`;
    }
  }

  // 7. Xử lý hiệu ứng khi có Nghi Thức mới
  let fortuneTimer = null;
  let grandTimer = null;

  function triggerRitualVisuals(ev) {
    if (!ev) return;

    if (ev.ttsText && ev.type !== 'drawFortune' && !(ev.type === 'idleTalk' && ev.card)) {
      audio.enqueueTts(ev.ttsText, { voice: ev.ttsVoice || DEFAULT_VOICE });
    }

    switch (ev.type) {
      case 'burnIncense': {
        audio.playIncenseChime();
        particles.spawnIncenseBurst(540, 895);
        particles.spawnFloatingMerit(T('meritFloat', '+{n} Công Đức', { n: ev.merit }), 540, 860, '#ffe082');
        animateWalkerOnCarpet(ev.user, ev.avatar, T('actIncense', '🔥 Dâng {count} nén hương (+{merit} CĐ)', ev), ev.wish);
        break;
      }

      case 'strikeWoodenFish': {
        audio.playWoodenFish();
        pulseHallBowing();
        particles.spawnFloatingMerit(T('meritFloat', '+{n} Công Đức', { n: ev.merit }), 890, 935, '#ffd54f');
        break;
      }

      case 'ringBell': {
        audio.playTempleBell(1.0);
        pulseHallBowing();
        particles.spawnBellWave(540, 510, 4);
        particles.spawnFloatingMerit(T('meritFloat', '+{n} Công Đức', { n: ev.merit }), 190, 935, '#fff3b0');
        Depth3D.flare(0.85);
        updateCentralWorshipper(ev.user, ev.avatar, T('actBell', '🔔 Thỉnh Đại Hồng Chung (+{merit} CĐ)', ev), ev.wish);
        break;
      }

      case 'sendPrayer': {
        audio.playIncenseChime();
        spawnSkyLantern(ev.user, ev.wish);
        particles.spawnFloatingMerit(T('meritFloat', '+{n} Công Đức', { n: ev.merit }), 540, 920, '#ffb74d');
        animateWalkerOnCarpet(ev.user, ev.avatar, T('actPrayer', '🏮 Cầu phúc (+{merit} CĐ)', ev), ev.wish);
        break;
      }

      case 'offerGift': {
        audio.playIncenseChime();
        audio.playTempleBell(0.85);
        particles.spawnIncenseBurst(540, 895);
        particles.spawnFloatingMerit(T('meritFloat', '+{n} Công Đức', { n: ev.merit }), 540, 840, '#fff3b0');
        animateWalkerOnCarpet(ev.user, ev.avatar, T('actGift', '🪷 Dâng {gift} (+{merit} CĐ)', { gift: ev.giftName, merit: ev.merit }), ev.wish);
        break;
      }

      case 'grandCeremony': {
        audio.playTempleBell(1.2);
        setTimeout(() => audio.playTempleBell(1.1), 900);
        particles.spawnGrandCeremonyRain();
        pulseHallBowing();
        Depth3D.flare(1);
        showGrandCeremonyBanner(ev.user, ev.giftName, ev.merit);
        animateWalkerOnCarpet(ev.user, ev.avatar, T('actGrand', '🐉 {gift} (+{merit} CĐ)', { gift: ev.giftName, merit: ev.merit }), ev.wish);
        break;
      }

      case 'drawFortune': {
        audio.playFortuneShake();
        updateCentralWorshipper(
          ev.user,
          ev.avatar,
          T('fortuneDrawing', '🎋 Đang xin xăm...'),
          T('fortuneDrawingWish', 'Thí chủ {user} đang thành tâm xin quẻ...', { user: ev.user }),
          false
        );
        // Chỉ hiển thị tờ Quẻ Xăm đúng thời điểm giọng đọc bắt đầu vang lên!
        audio.enqueueTts(ev.ttsText || '', {
          voice: ev.ttsVoice || DEFAULT_VOICE,
          onStart: () => {
            audio.playIncenseChime();
            showFortuneModal(ev.user, ev.fortune);
            updateCentralWorshipper(
              ev.user,
              ev.avatar,
              T('fortuneResult', '🎋 Quẻ số {number} ({rank})', ev.fortune || {}),
              ev.fortune?.meaning || '',
              true
            );
          },
          onEnd: () => {
            clearTimeout(fortuneTimer);
            fortuneTimer = setTimeout(() => {
              document.getElementById('fortuneModal')?.classList.remove('visible');
            }, 1800);
          }
        });
        break;
      }

      // ---- Sự kiện hệ thống 24/7 (không phải người xem) ----
      case 'announce': {
        // Giờ lễ theo lịch: gõ chuông N tiếng, hào quang bừng sáng, băng rôn tên buổi lễ
        const n = Math.max(1, Math.min(9, ev.bells || 1));
        for (let i = 0; i < n; i++) {
          setTimeout(() => {
            audio.playTempleBell(1.05);
            particles.spawnBellWave(540, 510, 3);
            Depth3D.flare(0.7);
          }, i * 2600);
        }
        pulseHallBowing();
        showGrandCeremonyBanner('', T('scheduleBadge', '🔔 {title}', ev), 0, `${T('clockLabel', '')} ${zonedClock().time}`.trim());
        break;
      }

      case 'idleTalk': {
        if (ev.card) {
          audio.enqueueTts(ev.ttsText || '', {
            voice: ev.ttsVoice || DEFAULT_VOICE,
            onStart: () => {
              audio.playIncenseChime();
              showFortuneModal('', ev.card);
            },
            onEnd: () => {
              clearTimeout(fortuneTimer);
              fortuneTimer = setTimeout(() => {
                document.getElementById('fortuneModal')?.classList.remove('visible');
              }, 2500);
            }
          });
        }
        Depth3D.flare(0.4);
        break;
      }

      case 'welcome': {
        audio.playIncenseChime();
        (ev.names || [ev.user]).forEach((name, i) => {
          setTimeout(() => particles.spawnFloatingMerit(`🙏 ${name}`, 260 + i * 280, 980, '#fff3b0'), i * 450);
        });
        break;
      }
    }
  }

  function spawnSkyLantern(user, wish) {
    const layer = document.getElementById('skyLanternsLayer');
    if (!layer) return;
    const lantern = document.createElement('div');
    lantern.className = 'sky-lantern';
    const leftPos = 80 + Math.floor(Math.random() * 640);
    lantern.style.left = `${leftPos}px`;
    lantern.innerHTML = `
      <div class="sky-lantern-user">🙏 ${escapeHtml(user)}</div>
      <div class="sky-lantern-wish">“${escapeHtml(wish)}”</div>
    `;
    layer.appendChild(lantern);
    setTimeout(() => {
      lantern.remove();
    }, 10600);
  }

  function showFortuneModal(user, fortune) {
    if (!fortune) return;
    const modal = document.getElementById('fortuneModal');
    document.getElementById('fortuneRankBadge').textContent = fortune.rank.toUpperCase();
    document.getElementById('fortuneTitle').textContent = T('fortuneTitle', 'Quẻ Số {number} — {title}', fortune);
    document.getElementById('fortuneDevotee').textContent = user
      ? T('fortuneDevotee', 'Thí chủ cầu quẻ: {user}', { user })
      : T('brand', 'CHÙA LINH ỨNG • ĐỨC PHẬT A DI ĐÀ');
    document.getElementById('fortunePoem').textContent = fortune.poem;
    document.getElementById('fortuneMeaning').textContent = T('fortuneMeaning', 'Lời bàn: {meaning}', fortune);

    modal.classList.add('visible');
    clearTimeout(fortuneTimer);
    fortuneTimer = setTimeout(() => {
      modal.classList.remove('visible');
    }, 15000);
  }

  document.getElementById('fortuneModal')?.addEventListener('click', () => {
    document.getElementById('fortuneModal').classList.remove('visible');
  });

  function showGrandCeremonyBanner(user, giftName, merit, subOverride) {
    const banner = document.getElementById('grandCeremonyBanner');
    document.getElementById('grandTitle').textContent = subOverride
      ? String(giftName)
      : `🐉 ${String(giftName).toUpperCase()} 🐉`;
    document.getElementById('grandSub').textContent = subOverride || T('grandSub', 'Đại Thí Chủ {user} • Công Đức Vô Lượng (+{merit} CĐ)', { user, merit });
    banner.classList.add('visible');
    clearTimeout(grandTimer);
    grandTimer = setTimeout(() => {
      banner.classList.remove('visible');
    }, 6800);
  }

  // 8. Kết nối JSON-RPC 2.0 WebSocket & Gửi Lệnh RPC
  let ws = null;
  let rpcId = 1;
  let wsDownSince = 0; // thời điểm bắt đầu mất kết nối WebSocket (0 = đang kết nối tốt)

  function connectWebSocket() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}/ws`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.method === 'temple.event' || msg.method === 'tts.play') {
          window.dispatchEvent(new Event('temple-activity'));
        }
        if (msg.method === 'temple.state') {
          updateUIState(msg.params);
        } else if (msg.method === 'temple.event') {
          if (msg.params?.state) updateUIState(msg.params.state);
          if (msg.params?.event) triggerRitualVisuals(msg.params.event);
        } else if (msg.method === 'tts.play') {
          if (msg.params?.url) {
            audio.enqueueTts(msg.params.text || T('defaultWish', 'Nam mô A Di Đà Phật'), {
              voice: msg.params.voice || DEFAULT_VOICE,
              url: msg.params.url
            });
          }
        }
      } catch (_) {}
    };

    ws.onopen = () => {
      wsDownSince = 0;
    };

    ws.onclose = () => {
      if (!wsDownSince) wsDownSince = Date.now();
      setTimeout(connectWebSocket, 2000);
    };
  }
  connectWebSocket();

  // 24/7 (OBS Browser Source chạy nhiều ngày):
  //  - Mất kết nối máy chủ quá 90 giây (server khởi động lại, mạng chập chờn) => tải lại trang sạch sẽ
  //  - Tự tải lại định kỳ (mặc định 12 giờ ở chế độ ?obs=1) để giải phóng bộ nhớ trình duyệt,
  //    chỉ thực hiện lúc đang yên tĩnh (không có giọng đọc / hiệu ứng). Tắt bằng ?reload=0
  const reloadHours = parseFloat(params.get('reload') ?? (params.get('obs') === '1' ? '12' : '0'));
  const bootAt = Date.now();
  let lastActivityAt = Date.now();
  window.addEventListener('temple-activity', () => {
    lastActivityAt = Date.now();
  });
  setInterval(() => {
    if (wsDownSince && Date.now() - wsDownSince > 90 * 1000) {
      console.warn('[Watchdog] Mất kết nối máy chủ quá lâu, tải lại trang...');
      window.location.reload();
      return;
    }
    if (reloadHours > 0 && Date.now() - bootAt > reloadHours * 3600 * 1000 && Date.now() - lastActivityAt > 20 * 1000) {
      console.log('[Watchdog] Tải lại định kỳ để giải phóng bộ nhớ');
      window.location.reload();
    }
  }, 10 * 1000);

  async function callRpc(method, params = {}) {
    audio.ensureContext();
    const payload = {
      jsonrpc: '2.0',
      id: rpcId++,
      method,
      params
    };
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return;
    }
    const res = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data?.result?.state) updateUIState(data.result.state);
    if (data?.result?.event) triggerRitualVisuals(data.result.event);
    return data;
  }

  function getFormInput() {
    const user = document.getElementById('inputDevoteeName')?.value.trim() || 'Quỳnh_Finn';
    const wish =
      document.getElementById('inputDevoteeWish')?.value.trim() ||
      'Cầu cho gia đình bình an, tài lộc hanh thông';
    return { user, wish };
  }

  // Gắn sự kiện tương tác trực tiếp trên màn hình 9:16 & Thanh HUD dưới đáy
  document.getElementById('incenseBurnerZone')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.burnIncense', { user, count: 3, wish });
  });

  document.getElementById('cardIncense')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.burnIncense', { user, count: 3, wish });
  });

  document.getElementById('cardBlessing')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.sendPrayer', { user, wish });
  });

  document.getElementById('cardLotus')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.offerGift', {
      user,
      giftType: 'lotus',
      coins: 20,
      giftName: 'Đài Hoa Sen Vàng',
      wish
    });
  });

  document.getElementById('woodenFishStation')?.addEventListener('click', () => {
    const { user } = getFormInput();
    callRpc('temple.strikeWoodenFish', { user, count: 1 });
  });

  document.getElementById('bellStation')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.ringBell', { user, count: 1, wish, readTts: true });
  });

  document.getElementById('fortuneCylinder')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.drawFortune', { user, topic: wish });
  });

  // Các nút trên Quick RPC Dock bên phải
  document.getElementById('btnRpcIncense')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.burnIncense', { user, count: 3, wish });
  });

  document.getElementById('btnRpcLantern')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.sendPrayer', { user, wish });
  });

  document.getElementById('btnRpcWoodenFish')?.addEventListener('click', () => {
    const { user } = getFormInput();
    callRpc('temple.strikeWoodenFish', { user, count: 5 });
  });

  document.getElementById('btnRpcBell')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.ringBell', { user, count: 1, wish, readTts: true });
  });

  document.getElementById('btnRpcFortune')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.drawFortune', { user, topic: wish });
  });

  document.getElementById('btnRpcGiftLotus')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.offerGift', {
      user,
      giftType: 'lotus',
      coins: 20,
      giftName: 'Đài Hoa Sen Vàng',
      wish
    });
  });

  document.getElementById('btnRpcGrandCeremony')?.addEventListener('click', () => {
    const { user, wish } = getFormInput();
    callRpc('temple.grandCeremony', {
      user,
      coins: 299,
      giftName: 'Đại Lễ Kim Long Chầu Phật',
      wish
    });
  });

  document.getElementById('btnConnectTikTok')?.addEventListener('click', () => {
    const username = document.getElementById('inputTikTokUser')?.value.trim();
    if (!username) return;
    callRpc('live.connect', { username });
  });

  let autoSimState = false;
  document.getElementById('btnToggleAutoSim')?.addEventListener('click', () => {
    autoSimState = !autoSimState;
    callRpc('live.setAutoSim', { enabled: autoSimState });
  });

  document.getElementById('btnToggleTts')?.addEventListener('click', (e) => {
    audio.ttsEnabled = !audio.ttsEnabled;
    const btn = e.currentTarget;
    btn.textContent = `🎙️ Giọng Đọc: ${audio.ttsEnabled ? 'BẬT' : 'TẮT'}`;
    btn.classList.toggle('active-toggle', audio.ttsEnabled);
  });

  document.getElementById('btnToggleMusic')?.addEventListener('click', (e) => {
    audio.bgMusicEnabled = !audio.bgMusicEnabled;
    if (audio.bgMusicEnabled) {
      audio.startZenAmbience();
    } else {
      audio.stopZenAmbience();
    }
    const btn = e.currentTarget;
    btn.textContent = `🎵 Nhạc Nền: ${audio.bgMusicEnabled ? 'BẬT' : 'TẮT'}`;
    btn.classList.toggle('active-toggle', audio.bgMusicEnabled);
  });

  // Khởi tạo và gắn sự kiện thanh trượt chỉnh âm lượng Nhạc nền & Giọng đọc
  const sliderMusicVol = document.getElementById('sliderMusicVol');
  const valMusicVol = document.getElementById('valMusicVol');
  if (sliderMusicVol && valMusicVol) {
    const initMusPct = Math.round(audio.bgBaseVolume * 100);
    sliderMusicVol.value = String(initMusPct);
    valMusicVol.textContent = `${initMusPct}%`;
    sliderMusicVol.addEventListener('input', (e) => {
      const pct = Number(e.target.value);
      valMusicVol.textContent = `${pct}%`;
      audio.ensureContext();
      audio.setMusicVolume(pct / 100);
    });
    sliderMusicVol.addEventListener('change', (e) => {
      const pct = Number(e.target.value);
      callRpc('temple.updateSettings', { musicVolume: +(pct / 100).toFixed(2) });
    });
  }

  const sliderTtsVol = document.getElementById('sliderTtsVol');
  const valTtsVol = document.getElementById('valTtsVol');
  if (sliderTtsVol && valTtsVol) {
    const initTtsPct = Math.round(audio.ttsVolume * 100);
    sliderTtsVol.value = String(initTtsPct);
    valTtsVol.textContent = `${initTtsPct}%`;
    sliderTtsVol.addEventListener('input', (e) => {
      const pct = Number(e.target.value);
      valTtsVol.textContent = `${pct}%`;
      audio.setTtsVolume(pct / 100);
    });
    sliderTtsVol.addEventListener('change', (e) => {
      const pct = Number(e.target.value);
      callRpc('temple.updateSettings', { ttsVolume: +(pct / 100).toFixed(2) });
    });
  }

  function shortenName(name, maxLen = 13) {
    const str = String(name || '');
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
