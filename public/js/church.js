/**
 * Bộ điều khiển phòng NHÀ THỜ (기도의 집) — nối WebSocket JSON-RPC với cảnh 3D + giọng đọc + giao diện.
 * Dùng chung máy chủ với phòng Chùa: tên phương thức giữ nguyên (temple.*), chỉ khác ý nghĩa:
 *   burnIncense=thắp nến • strikeWoodenFish=Amen • ringBell=chuông • sendPrayer=ý cầu nguyện
 *   offerGift=quà cảm tạ • grandCeremony=Hallelujah • drawFortune=câu Kinh Thánh hôm nay
 */
import { createChurch3D } from './church3d.js';

const params = new URLSearchParams(location.search);
if (params.get('obs') === '1') document.body.classList.add('obs-mode');

// ---------------------------------------------------------------------------
// 0. Gói câu chữ
// ---------------------------------------------------------------------------
const PACK = window.ROOM_PACK || { ui: {}, meta: { numberLocale: 'ko-KR' }, tts: { voice: 'ko-KR-SunHiNeural' } };
const UI = PACK.ui || {};
const NUM_LOCALE = PACK.meta?.numberLocale || 'ko-KR';
const DEFAULT_VOICE = PACK.tts?.voice || 'ko-KR-SunHiNeural';
const fmt = (n) => Number(n || 0).toLocaleString(NUM_LOCALE);
function T(key, fallback, vars = {}) {
  const tpl = UI[key] != null ? String(UI[key]) : fallback;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}
if (UI.pageTitle) document.title = UI.pageTitle;
document.querySelectorAll('[data-i18n]').forEach((el) => {
  if (UI[el.dataset.i18n] != null) el.textContent = UI[el.dataset.i18n];
});
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortenName = (name, max = 12) => {
  const s = String(name || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// ---------------------------------------------------------------------------
// 1. Co giãn khung 1080×1920
// ---------------------------------------------------------------------------
const stageWrapper = $('stageWrapper');
const stage = $('stage9x16');
function fitStage() {
  const rect = stageWrapper.getBoundingClientRect();
  stage.style.transform = `scale(${rect.width / 1080})`;
}
window.addEventListener('resize', fitStage);
fitStage();

// ---------------------------------------------------------------------------
// 2. Âm thanh, hiệu ứng 2D, cảnh 3D
// ---------------------------------------------------------------------------
const audio = new window.TempleAudioEngine();
const particles = new window.TempleParticleEngine($('templeCanvas'), { petals: false });
const scene3d = createChurch3D($('church3dCanvas'));
if (scene3d) {
  document.body.classList.add('fx3d-on');
  $('church3dCanvas').addEventListener('church3d-lost', () => document.body.classList.remove('fx3d-on'));
}
const fx = scene3d || {
  setCandles() {},
  prayerOrb() {},
  amenHearts() {},
  bell() {},
  hallelujah() {},
  flare() {},
  vipAnchors: () => [],
  standAnchor: () => ({ x: 250, y: 1080, visible: true }),
  crossAnchor: () => ({ x: 540, y: 560, visible: true })
};

function unlockAudioOnce() {
  audio.ensureContext();
  const b = $('btnUnlockAudio');
  if (b) {
    b.textContent = '✅ Âm thanh đã bật';
    b.classList.remove('gold');
    b.classList.add('active-toggle');
  }
}
window.addEventListener('pointerdown', unlockAudioOnce, { once: true });

// ---------------------------------------------------------------------------
// 3. Đồng hồ Seoul + giờ cầu nguyện kế tiếp
// ---------------------------------------------------------------------------
const ROOM_TZ = PACK.meta?.timeZone || 'Asia/Seoul';
function zonedClock(date = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: ROOM_TZ, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' })
    .formatToParts(date)
    .forEach((p) => (parts[p.type] = p.value));
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return { time: `${hh}:${parts.minute}`, weekday: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday] ?? 0 };
}
function nextScheduleItem() {
  const list = Array.isArray(PACK.schedule) ? PACK.schedule : [];
  const now = zonedClock();
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (let d = 0; d < 8; d++) {
    const wd = (now.weekday + d) % 7;
    const c = list
      .filter((it) => !Array.isArray(it.days) || it.days.includes(wd))
      .filter((it) => d > 0 || toMin(it.time) > toMin(now.time))
      .sort((a, b) => toMin(a.time) - toMin(b.time));
    if (c.length) return c[0];
  }
  return null;
}
function renderClock() {
  const el = $('roomClock');
  const next = nextScheduleItem();
  el.hidden = false;
  el.textContent = `🕰 ${T('clockLabel', '서울')} ${zonedClock().time}${next ? ` · ${next.title} ${next.time}` : ''}`;
}
renderClock();
setInterval(renderClock, 15 * 1000);

// ---------------------------------------------------------------------------
// 4. Thẻ tên VIP bám theo hàng ghế đầu trong cảnh 3D
// ---------------------------------------------------------------------------
const vipLayer = $('vipTagsLayer');
const vipTags = [];
for (let i = 0; i < 6; i++) {
  const el = document.createElement('div');
  el.className = 'vip-seat-tag';
  el.innerHTML = `<span class="vip-rank">${i + 1}</span><span class="vip-name"></span>`;
  el.style.display = 'none';
  vipLayer.appendChild(el);
  vipTags.push(el);
}
let vipNames = [];
function placeOverlays() {
  const anchors = fx.vipAnchors();
  vipTags.forEach((el, i) => {
    const a = anchors[i];
    const name = vipNames[i];
    if (!a || !a.visible || !name) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    // hạng 3-4 ngồi xa lối đi hơn => nâng thẻ lên một tầng cho khỏi chạm thẻ hạng 5-6
    const lift = i === 2 || i === 3 ? 44 : 0;
    el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${(a.y - lift).toFixed(1)}px, 0) translate(-50%, -100%)`;
  });
  const s = fx.standAnchor();
  $('candleStandTag').style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
}
if (scene3d) scene3d.onFrame = placeOverlays;
else placeOverlays();

// ---------------------------------------------------------------------------
// 5. Cập nhật giao diện theo trạng thái máy chủ
// ---------------------------------------------------------------------------
function updateUIState(st) {
  if (!st) return;
  const candles = Math.min(36, st.activeIncenseSticks || 0);
  fx.setCandles(candles);
  $('candleCount').textContent = candles;
  $('statCandles').textContent = fmt(st.totalIncense);
  $('statAmen').textContent = fmt(st.woodenFishHits);

  const lb = Array.isArray(st.leaderboard) ? st.leaderboard : [];
  vipNames = lb.slice(0, 6).map((d) => d.name);
  vipTags.forEach((el, i) => {
    el.querySelector('.vip-name').textContent = shortenName(vipNames[i] || '', 9);
  });
  if (!scene3d) placeOverlays();
  $('leaderboardList').innerHTML = lb
    .slice(0, 4)
    .map(
      (it) => `<div class="leader-item"><span class="leader-rank">${it.rank}</span>` +
        `<span class="leader-name">${escapeHtml(shortenName(it.name, 12))}</span>` +
        `<span class="leader-merit">${fmt(it.merit)}</span></div>`
    )
    .join('');

  const liveDot = $('liveDot');
  const liveText = $('liveStatusText');
  if (st.tiktok?.connected) {
    liveDot.classList.add('connected');
    liveText.textContent = T('liveViewers', 'LIVE @{user} • {n}', { user: st.tiktok.username, n: fmt(st.tiktok.viewerCount) });
  } else if (st.tiktok?.connecting) {
    liveDot.classList.remove('connected');
    liveText.textContent = T('connecting', '@{user}...', { user: st.tiktok.username });
  } else {
    liveDot.classList.remove('connected');
    liveText.textContent = st.settings?.autoSim ? T('brandSim', '시뮬레이션') : T('brand', '24시 기도의 집');
  }
  const btnSim = $('btnToggleAutoSim');
  if (btnSim && st.settings) {
    btnSim.textContent = `🤖 Giả lập người xem (chỉ để thử): ${st.settings.autoSim ? 'ĐANG BẬT' : 'TẮT'}`;
    btnSim.classList.toggle('active-toggle', Boolean(st.settings.autoSim));
  }
  if (st.settings && typeof st.settings.musicVolume === 'number') setSlider('Music', st.settings.musicVolume);
  if (st.settings && typeof st.settings.ttsVolume === 'number') setSlider('Tts', st.settings.ttsVolume);
  if (st.tiktok?.username && !$('inputTikTokUser').value) $('inputTikTokUser').value = `@${st.tiktok.username}`;

  $('eventFeed').innerHTML = (st.recentEvents || [])
    .slice(0, 8)
    .map((ev) => `<div class="event-feed-item">${feedLine(ev)}</div>`)
    .join('');
}

function setSlider(kind, vol) {
  if (kind === 'Music') audio.setMusicVolume(vol);
  else audio.setTtsVolume(vol);
  const pct = Math.round(vol * 100);
  $(`slider${kind}Vol`).value = String(pct);
  $(`val${kind}Vol`).textContent = `${pct}%`;
}

function feedLine(ev) {
  const u = `<strong>${escapeHtml(ev.user || '')}</strong>`;
  switch (ev.type) {
    case 'burnIncense': return `🕯️ ${u} thắp ${ev.count} nến`;
    case 'strikeWoodenFish': return `🙌 ${u} Amen ×${ev.count}`;
    case 'ringBell': return `🔔 ${u} rung chuông`;
    case 'sendPrayer': return `🙏 ${u}: “${escapeHtml(ev.wish)}”`;
    case 'offerGift':
    case 'grandCeremony': return `💐 ${u} tặng <em>${escapeHtml(ev.giftName)}</em> (+${ev.merit})`;
    case 'drawFortune': return `📖 ${u} nhận câu ${escapeHtml(ev.fortune?.rank || '')}`;
    case 'announce': return `🕰️ Giờ cầu nguyện: ${u}`;
    case 'idleTalk': return `📜 Tự đọc khi phòng vắng${ev.card ? `: ${escapeHtml(ev.card.rank)}` : ''}`;
    case 'welcome': return `💛 Chào người theo dõi: ${escapeHtml((ev.names || [ev.user]).join(', '))}`;
    default: return `✨ ${u}`;
  }
}

function setNotice(user, action) {
  $('devoteeNameLine').textContent = user || T('defaultName', '성도님');
  $('devoteeActionTag').textContent = action || '';
}

// Ý cầu nguyện bay lên (dùng lại kiểu "đèn trời" của phòng Chùa, đổi màu)
function spawnPrayerCard(user, wish) {
  const layer = $('skyLanternsLayer');
  const el = document.createElement('div');
  el.className = 'sky-lantern prayer-card';
  el.style.left = `${120 + Math.floor(Math.random() * 560)}px`;
  el.innerHTML = `<div class="sky-lantern-user">🙏 ${escapeHtml(user)}</div><div class="sky-lantern-wish">“${escapeHtml(wish)}”</div>`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 10600);
}

let verseTimer = null;
function showVerse(card, user) {
  if (!card) return;
  $('verseRef').textContent = card.rank;
  $('verseTitle').textContent = card.title;
  $('verseFor').textContent = user ? T('verseFor', '{user}', { user }) : T('brand', '');
  $('verseText').textContent = card.poem;
  $('verseReflect').textContent = T('verseReflect', '{meaning}', card);
  $('verseModal').classList.add('visible');
  clearTimeout(verseTimer);
  verseTimer = setTimeout(() => $('verseModal').classList.remove('visible'), 20000);
}
function hideVerseSoon(ms = 2200) {
  clearTimeout(verseTimer);
  verseTimer = setTimeout(() => $('verseModal').classList.remove('visible'), ms);
}
$('verseModal').addEventListener('click', () => $('verseModal').classList.remove('visible'));

let bannerTimer = null;
function showBanner(title, sub, ms = 6800) {
  $('grandTitle').textContent = title;
  $('grandSub').textContent = sub;
  $('grandCeremonyBanner').classList.add('visible');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $('grandCeremonyBanner').classList.remove('visible'), ms);
}

// ---------------------------------------------------------------------------
// 6. Hiệu ứng theo từng sự kiện
// ---------------------------------------------------------------------------
function triggerVisuals(ev) {
  if (!ev) return;
  const speakNow = ev.ttsText && ev.type !== 'drawFortune' && !(ev.type === 'idleTalk' && ev.card);
  if (speakNow) audio.enqueueTts(ev.ttsText, { voice: ev.ttsVoice || DEFAULT_VOICE });
  const stand = fx.standAnchor();
  const cross = fx.crossAnchor();

  switch (ev.type) {
    case 'burnIncense':
      audio.playIncenseChime();
      fx.flare(0.25);
      particles.spawnIncenseBurst(stand.x, stand.y + 60);
      particles.spawnFloatingMerit(T('actIncense', '🕯️ {count}', ev), stand.x, stand.y - 20, '#ffd28a');
      setNotice(ev.user, T('actIncense', '🕯️ {count}', ev));
      break;
    case 'strikeWoodenFish':
      audio.playIncenseChime();
      fx.amenHearts(Math.min(8, ev.count || 1));
      particles.spawnFloatingMerit(T('actAmen', '🙌 ×{count}', ev), 860, 1180, '#ffb3c8');
      break;
    case 'ringBell':
      audio.playTempleBell(1.0);
      fx.bell();
      particles.spawnBellWave(cross.x, cross.y, 3);
      setNotice(ev.user, T('actBell', '🔔'));
      break;
    case 'sendPrayer':
      audio.playIncenseChime();
      fx.prayerOrb();
      spawnPrayerCard(ev.user, ev.wish);
      setNotice(ev.user, T('actPrayer', '🙏'));
      break;
    case 'offerGift':
      audio.playIncenseChime();
      audio.playTempleBell(0.7);
      fx.flare(0.5);
      fx.amenHearts(5);
      particles.spawnFloatingMerit(T('meritFloat', '+{n}', { n: ev.merit }), 540, 1150, '#fff3b0');
      setNotice(ev.user, T('actGift', '💐 {gift}', { gift: ev.giftName }));
      break;
    case 'grandCeremony':
      audio.playHallelujahChord?.();
      setTimeout(() => audio.playTempleBell(1.1), 700);
      fx.hallelujah();
      particles.spawnGrandCeremonyRain();
      showBanner(`✨ ${ev.giftName} ✨`, T('grandSub', '{user}', { user: ev.user, merit: ev.merit }));
      setNotice(ev.user, T('actGrand', '✨ {gift}', { gift: ev.giftName }));
      break;
    case 'drawFortune':
      audio.playFortuneShake?.();
      setNotice(ev.user, T('verseLoading', '📖 ...'));
      audio.enqueueTts(ev.ttsText || '', {
        voice: ev.ttsVoice || DEFAULT_VOICE,
        onStart: () => {
          audio.playIncenseChime();
          fx.flare(0.5);
          showVerse(ev.fortune, ev.user);
          setNotice(ev.user, `📖 ${ev.fortune?.rank || ''}`);
        },
        onEnd: () => hideVerseSoon(2200)
      });
      break;
    case 'announce': {
      const n = Math.max(1, Math.min(9, ev.bells || 1));
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          audio.playTempleBell(1.0);
          fx.bell();
          particles.spawnBellWave(cross.x, cross.y, 2);
        }, i * 2600);
      }
      showBanner(T('scheduleBadge', '🔔 {title}', ev), `${T('clockLabel', '')} ${zonedClock().time}`.trim(), 9000);
      setNotice(ev.title, '');
      break;
    }
    case 'idleTalk':
      if (ev.card) {
        audio.enqueueTts(ev.ttsText || '', {
          voice: ev.ttsVoice || DEFAULT_VOICE,
          onStart: () => {
            fx.flare(0.35);
            showVerse(ev.card, '');
          },
          onEnd: () => hideVerseSoon(3000)
        });
      } else {
        fx.flare(0.25);
      }
      break;
    case 'welcome':
      audio.playIncenseChime();
      fx.amenHearts(4);
      (ev.names || [ev.user]).forEach((name, i) =>
        setTimeout(() => particles.spawnFloatingMerit(`💛 ${name}`, 260 + i * 280, 1250, '#fff3b0'), i * 450)
      );
      break;
  }
}

// ---------------------------------------------------------------------------
// 7. WebSocket JSON-RPC + tự phục hồi khi chạy 24/7
// ---------------------------------------------------------------------------
let ws = null;
let rpcId = 1;
let wsDownSince = 0;
let lastActivityAt = Date.now();
function connectWebSocket() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.method === 'temple.state') updateUIState(msg.params);
      else if (msg.method === 'temple.event') {
        lastActivityAt = Date.now();
        if (msg.params?.state) updateUIState(msg.params.state);
        triggerVisuals(msg.params?.event);
      } else if (msg.method === 'tts.play' && msg.params?.url) {
        lastActivityAt = Date.now();
        audio.enqueueTts(msg.params.text || '', { voice: msg.params.voice || DEFAULT_VOICE, url: msg.params.url });
      }
    } catch (_) {}
  };
  ws.onopen = () => (wsDownSince = 0);
  ws.onclose = () => {
    if (!wsDownSince) wsDownSince = Date.now();
    setTimeout(connectWebSocket, 2000);
  };
}
connectWebSocket();

const reloadHours = parseFloat(params.get('reload') ?? (params.get('obs') === '1' ? '12' : '0'));
const bootAt = Date.now();
setInterval(() => {
  if (wsDownSince && Date.now() - wsDownSince > 90 * 1000) location.reload();
  else if (reloadHours > 0 && Date.now() - bootAt > reloadHours * 3600 * 1000 && Date.now() - lastActivityAt > 20 * 1000) {
    location.reload();
  }
}, 10 * 1000);

async function callRpc(method, p = {}) {
  audio.ensureContext();
  const payload = { jsonrpc: '2.0', id: rpcId++, method, params: p };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return null;
  }
  const res = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return res.json();
}

// ---------------------------------------------------------------------------
// 8. Bảng điều khiển người vận hành
// ---------------------------------------------------------------------------
const form = () => ({
  user: $('inputDevoteeName').value.trim() || '김은혜',
  uniqueId: ($('inputDevoteeName').value.trim() || 'test').toLowerCase().replace(/\s+/g, ''),
  wish: $('inputDevoteeWish').value.trim() || PACK.ui?.defaultWish || ''
});
const bind = (id, fn) => $(id)?.addEventListener('click', fn);
bind('btnUnlockAudio', unlockAudioOnce);
bind('btnCandle', () => callRpc('temple.burnIncense', { ...form(), count: 3 }));
bind('btnPrayer', () => callRpc('temple.sendPrayer', form()));
bind('btnAmen', () => callRpc('temple.strikeWoodenFish', { ...form(), count: 5 }));
bind('btnBell', () => callRpc('temple.ringBell', { ...form(), count: 1, readTts: true }));
bind('btnVerse', () => callRpc('temple.drawFortune', { ...form(), topic: form().wish }));
bind('btnGift', () => callRpc('temple.offerGift', { ...form(), giftType: 'lotus', coins: 10 }));
bind('btnGrand', () => callRpc('temple.grandCeremony', { ...form(), coins: 299 }));
bind('btnAnnounce', () => callRpc('room.announce', { index: 0 }));
bind('btnIdle', () => callRpc('room.idleTalk', {}));
bind('btnConnectTikTok', () => callRpc('live.connect', { username: $('inputTikTokUser').value.trim() }));
bind('btnToggleAutoSim', () =>
  callRpc('live.setAutoSim', { enabled: !$('btnToggleAutoSim').classList.contains('active-toggle') })
);
bind('btnToggleTts', (e) => {
  audio.ttsEnabled = !audio.ttsEnabled;
  e.currentTarget.textContent = `🎙️ Giọng Đọc: ${audio.ttsEnabled ? 'BẬT' : 'TẮT'}`;
  e.currentTarget.classList.toggle('active-toggle', audio.ttsEnabled);
});
bind('btnToggleMusic', (e) => {
  audio.bgMusicEnabled = !audio.bgMusicEnabled;
  if (audio.bgMusicEnabled) audio.startZenAmbience();
  else audio.stopZenAmbience();
  e.currentTarget.textContent = `🎵 Nhạc Nền: ${audio.bgMusicEnabled ? 'BẬT' : 'TẮT'}`;
  e.currentTarget.classList.toggle('active-toggle', audio.bgMusicEnabled);
});
for (const kind of ['Music', 'Tts']) {
  $(`slider${kind}Vol`).addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    setSlider(kind, v);
    callRpc('temple.updateSettings', { [kind === 'Music' ? 'musicVolume' : 'ttsVolume']: +v.toFixed(2) });
  });
}

window.ChurchRoom = { triggerVisuals, callRpc, get stats() { return scene3d?.stats; } };
