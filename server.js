const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

const { loadPack, clientPack } = require('./lib/packs');
const { speakableName } = require('./lib/packs/korean');
const { zonedNowIn, isScheduleDue } = require('./lib/zoned-time');

// Gói phòng: loại phòng (chùa / nhà thờ) + ngôn ngữ. Ví dụ: ROOM=church LOCALE=ko  hoặc  PACK=temple.ko
const PACK = loadPack({ pack: process.env.PACK, room: process.env.ROOM, locale: process.env.LOCALE });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const TTS_CACHE_DIR = path.join(DATA_DIR, 'tts-cache');
// Mỗi phòng một file trạng thái riêng => chạy nhiều phòng cùng lúc không ghi đè nhau.
// (Phòng chùa tiếng Việt giữ tên file cũ để không mất Bảng Vàng Công Đức đã có)
const STATE_FILE = path.join(DATA_DIR, PACK.id === 'temple.vi' ? 'merit-state.json' : `merit-state.${PACK.id}.json`);

fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });

// 1. Bộ quẻ / lời dạy / câu Kinh Thánh nằm trong gói phòng: lib/packs/*.js (PACK.deck)
const FORTUNE_DECK = PACK.deck;

// ============================================================================
// 2. TTS PYTHON WORKER MANAGER
//    - zerotts: ZeroTTS chạy offline, giọng Mai Chi (tiếng Việt) — tts_worker.py
//    - edge   : giọng thần kinh Microsoft qua edge-tts (tiếng Hàn & nhiều ngôn ngữ, cần Internet) — tts_worker_edge.py
//    - vibi   : API Vibi (giọng ElevenLabs / MiniMax / CapCut, trả phí theo ký tự) — tts_worker_vibi.py
//    Chọn bằng TTS_ENGINE=zerotts|edge|vibi (mặc định theo gói phòng). Các worker dùng chung 1 giao thức JSON.
// ============================================================================
//    - local  : Qwen3-TTS chạy ngay trên máy (miễn phí, offline, hợp Mac M1) — tts_worker_local.py
const TTS_WORKERS = {
  zerotts: 'tts_worker.py',
  edge: 'tts_worker_edge.py',
  vibi: 'tts_worker_vibi.py',
  local: 'tts_worker_local.py'
};
const TTS_ENGINE = (() => {
  const e = String(process.env.TTS_ENGINE || PACK.tts.engine || 'zerotts').toLowerCase();
  return TTS_WORKERS[e] ? e : 'zerotts';
})();
// Vibi: 1 giọng cố định cho cả phòng (VIBI_VOICE_ID). Dự phòng edge-tts dùng giọng của gói phòng.
const TTS_DEFAULT_VOICE =
  TTS_ENGINE === 'vibi'
    ? process.env.VIBI_VOICE_ID || 'vibi'
    : TTS_ENGINE === 'local'
      ? 'qwen3-local'
      : process.env.TTS_VOICE || PACK.tts.voice || 'maichi';
// Mô hình chạy trên máy cần thời gian nạp và mỗi câu lâu hơn (nhất là máy không có GPU)
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS) || (TTS_ENGINE === 'local' ? 120000 : 30000);

function isEdgeVoice(v) {
  return /^[a-z]{2,3}-[a-z]{2,4}-[a-z]+neural$/i.test(String(v || ''));
}

// Giọng đang dùng: lấy từ cài đặt nếu hợp với bộ máy đọc hiện tại, không thì dùng giọng mặc định của gói
function currentVoice() {
  const v = state?.settings?.ttsVoice;
  if (!v || TTS_ENGINE === 'vibi' || TTS_ENGINE === 'local') return TTS_DEFAULT_VOICE;
  if (TTS_ENGINE === 'edge') return isEdgeVoice(v) ? v : TTS_DEFAULT_VOICE;
  return isEdgeVoice(v) ? TTS_DEFAULT_VOICE : v;
}

class ZeroTTSManager {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.status = 'starting';
    this.engine = TTS_ENGINE;
    this.voice = TTS_DEFAULT_VOICE;
    this.voices = [TTS_DEFAULT_VOICE];
    this.model = { edge: 'edge-tts', vibi: 'vibi.pro', zerotts: 'zeroweight-ai/ZeroTTS', local: 'Qwen3-TTS' }[TTS_ENGINE];
    this.pending = new Map();
    this.inflight = new Map();
    this.reqCounter = 0;
    this.buffer = '';
    this.restartDelayMs = 5000; // tăng dần tới 10 phút nếu worker cứ chết liên tục
    this.restartTimer = null;
    this.shuttingDown = false;
    this.startWorker();
  }

  // 24/7: worker Python chết (hết RAM, lỗi model...) => tự khởi động lại với độ trễ tăng dần
  scheduleRestart() {
    if (this.shuttingDown || this.restartTimer) return;
    const delay = this.restartDelayMs;
    this.restartDelayMs = Math.min(10 * 60 * 1000, this.restartDelayMs * 2);
    console.warn(`[ZeroTTS] Sẽ khởi động lại worker sau ${Math.round(delay / 1000)}s`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startWorker();
    }, delay);
    this.restartTimer.unref?.();
  }

  stop() {
    this.shuttingDown = true;
    clearTimeout(this.restartTimer);
    try {
      this.proc?.kill('SIGTERM');
    } catch (_) {}
  }

  resolvePythonBin() {
    // Chỉ định Python riêng (vd. môi trường có cài Qwen3-TTS): TTS_PYTHON=/đường/dẫn/python
    if (process.env.TTS_PYTHON) return process.env.TTS_PYTHON;
    // Linux/macOS: .venv/bin/python • Windows: .venv\Scripts\python.exe
    const candidates = [
      path.join(__dirname, '.venv', 'bin', 'python'),
      path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) return found;
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  startWorker() {
    const pyBin = this.resolvePythonBin();
    const scriptPath = path.join(__dirname, TTS_WORKERS[this.engine]);
    console.log(`[TTS] Khởi chạy worker ${this.engine} với ${pyBin} (giọng mặc định: ${TTS_DEFAULT_VOICE})...`);

    this.status = 'loading';
    this.proc = spawn(pyBin, [scriptPath], {
      cwd: __dirname,
      // Edge (chính hoặc dự phòng cho Vibi) luôn dùng giọng Microsoft của gói phòng
      env: {
        ...process.env,
        EDGE_TTS_VOICE:
          process.env.EDGE_TTS_VOICE || (isEdgeVoice(TTS_DEFAULT_VOICE) ? TTS_DEFAULT_VOICE : PACK.tts.edgeVoice || PACK.tts.voice)
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleWorkerLine(line.trim());
      }
    });

    this.proc.stderr.on('data', (chunk) => {
      const msg = chunk.toString('utf8').trim();
      if (msg) console.log(`[ZeroTTS stderr] ${msg}`);
    });

    this.proc.on('error', (err) => {
      console.warn('[ZeroTTS] Không chạy được worker:', err.message);
    });

    this.proc.on('exit', (code) => {
      console.warn(`[ZeroTTS] Worker thoát với mã ${code}`);
      this.proc = null;
      this.ready = false;
      this.status = 'stopped';
      this.scheduleRestart();
      for (const [, item] of this.pending) {
        clearTimeout(item.timer);
        item.resolve({ ok: false, error: 'ZeroTTS worker exited' });
      }
      this.pending.clear();
    });
  }

  handleWorkerLine(line) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'status') {
        this.status = msg.status;
        this.model = msg.model || this.model;
        broadcastNotification('tts.status', this.getStatus());
      } else if (msg.type === 'ready') {
        this.ready = true;
        this.status = 'ready';
        this.restartDelayMs = 5000;
        this.voice = msg.voice || TTS_DEFAULT_VOICE;
        this.voices = msg.voices || [TTS_DEFAULT_VOICE];
        this.model = msg.model || this.model;
        console.log(`[ZeroTTS] Sẵn sàng sau ${msg.loadSec}s! Giọng: ${this.voice} (${this.voices.join(', ')})`);
        broadcastNotification('tts.status', this.getStatus());
      } else if (msg.type === 'result' && msg.id != null) {
        const entry = this.pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(msg.id);
          entry.resolve(msg);
        }
      } else if (msg.type === 'error') {
        console.error('[ZeroTTS Error]', msg.error);
        this.status = 'error';
        broadcastNotification('tts.status', this.getStatus());
      }
    } catch (err) {
      console.log('[ZeroTTS stdout]', line);
    }
  }

  getStatus() {
    return {
      ready: this.ready,
      status: this.status,
      engine: {
        edge: 'edge-tts (Microsoft Neural)',
        vibi: `Vibi (${process.env.VIBI_PROVIDER || 'elevenlabs'})`,
        local: 'Qwen3-TTS (chạy trên máy)',
        zerotts: 'ZeroTTS (zeroweight-ai/ZeroTTS)'
      }[this.engine],
      voice: currentVoice(),
      voices: this.voices,
      model: this.model
    };
  }

  synthesize(text, voiceOverride) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return Promise.resolve({ ok: false, error: 'Empty text' });
    const rawVoice = voiceOverride || currentVoice();
    // ZeroTTS dùng tên giọng chữ thường; edge-tts / Vibi phân biệt hoa/thường
    const voice = this.engine === 'zerotts' ? String(rawVoice).toLowerCase() : String(rawVoice);
    const dedupKey = `${voice}::${cleanText}`;

    if (this.inflight.has(dedupKey)) {
      return this.inflight.get(dedupKey);
    }

    const promise = new Promise((resolve) => {
      if (!this.proc || !this.ready) {
        return resolve({ ok: false, error: `ZeroTTS đang ở trạng thái: ${this.status}` });
      }
      const id = ++this.reqCounter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'TTS synthesis timeout' });
      }, TTS_TIMEOUT_MS);

      this.pending.set(id, { resolve, timer });
      const payload = JSON.stringify({ id, text: cleanText, voice }) + '\n';
      this.proc.stdin.write(payload);
    }).finally(() => {
      this.inflight.delete(dedupKey);
    });

    this.inflight.set(dedupKey, promise);
    return promise;
  }
}

// ============================================================================
// 3. TRẠNG THÁI CHÙA ONLINE & BẢNG VÀNG CÔNG ĐỨC
// ============================================================================
const DEFAULT_STATE = {
  totalIncense: 108,
  totalMerit: 1080,
  woodenFishHits: 360,
  bellRings: 36,
  lanternCount: 18,
  fortuneCount: 12,
  activeIncenseSticks: 9,
  haloIntensity: 0.45,
  offerings: {
    lotus: 3,
    fruit: 2,
    lamp: 2,
    dragon: 1
  },
  devotees: {},
  recentEvents: [],
  settings: {
    ttsEnabled: true,
    ttsVoice: TTS_DEFAULT_VOICE,
    bgMusicEnabled: true,
    sfxEnabled: true,
    smokeDensity: 1.0,
    autoSim: false,
    autoSimIntervalMs: 9500
  },
  tiktok: {
    connected: false,
    connecting: false,
    username: 'zenfacts_vn',
    roomId: null,
    viewerCount: 0,
    lastError: null
  }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        ...DEFAULT_STATE,
        ...saved,
        devotees: saved.devotees || {},
        offerings: { ...DEFAULT_STATE.offerings, ...(saved.offerings || {}) },
        settings: { ...DEFAULT_STATE.settings, ...(saved.settings || {}) },
        tiktok: { ...DEFAULT_STATE.tiktok }
      };
    }
  } catch (e) {
    console.warn('[State] Không đọc được merit-state.json, dùng mặc định:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

let state = loadState();

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    pruneDevotees();
    const toSave = {
      totalIncense: state.totalIncense,
      totalMerit: state.totalMerit,
      woodenFishHits: state.woodenFishHits,
      bellRings: state.bellRings,
      lanternCount: state.lanternCount,
      fortuneCount: state.fortuneCount,
      activeIncenseSticks: state.activeIncenseSticks,
      offerings: state.offerings,
      devotees: state.devotees,
      settings: state.settings
    };
    // Ghi ra file tạm rồi đổi tên => mất điện / crash giữa chừng không làm hỏng Bảng Vàng Công Đức
    const tmp = `${STATE_FILE}.tmp`;
    fs.promises
      .writeFile(tmp, JSON.stringify(toSave, null, 2), 'utf8')
      .then(() => fs.promises.rename(tmp, STATE_FILE))
      .catch((e) => {
        console.error('[State] Lỗi lưu file:', e.message);
      });
  }, 1200);
}

function getLeaderboard(limit = 6) {
  return Object.values(state.devotees)
    .sort((a, b) => b.merit - a.merit)
    .slice(0, limit)
    .map((d, index) => ({
      rank: index + 1,
      name: d.name,
      uniqueId: d.uniqueId,
      avatar: d.avatar || '',
      merit: d.merit,
      incense: d.incense || 0,
      lastWish: d.lastWish || ''
    }));
}
// Bộ lọc chặn ký tự lạ (Cuneiform 𒐫, Zalgo, Braille, ký tự spam) & từ ngữ phản cảm
const WEIRD_SPAM_RE = /[\u{12000}-\u{1254F}\uFDFD\u2800-\u28FF\u2580-\u259F]|[\u0300-\u036F]{3,}/u;
const BRACKET_EMOTE_RE = /\[[^\]]{1,24}\]/g;
// Cho phép: chữ Latin + dấu tiếng Việt + chữ Hàn (Hangul: âm tiết AC00–D7A3, chữ cái 3130–318F)
const HANGUL = '\\u3130-\\u318F\\uAC00-\\uD7A3';
const ALLOWED_VI_TEXT_RE = new RegExp(`[^0-9a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ${HANGUL}\\s.,!?]`, 'g');
const ALLOWED_VI_NAME_RE = new RegExp(`[^0-9a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ${HANGUL}\\s._-]`, 'g');
const VI_LETTER_RE = new RegExp(`[a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ\\uAC00-\\uD7A3]`, 'g');
const BAD_WORDS_RE = /(đá dái|địt|lồn|cặc|đm|vcl|vl|yamate|i cư|lừa đảo|lừa à|te-le gram|telegram|bố là trùm)/i;
// Từ tục / xúc phạm / lừa đảo phổ biến trong bình luận tiếng Hàn (cả dạng viết tắt phụ âm)
const BAD_WORDS_KO_RE = /(시발|씨발|씨빨|시바|ㅅㅂ|ㅆㅂ|병신|ㅂㅅ|븅신|개새끼|개새|ㄱㅅㄲ|좆|존나|ㅈㄴ|지랄|ㅈㄹ|미친놈|미친년|꺼져|닥쳐|느금|니애미|애미|섹스|야동|텔레그램|카톡방|리딩방|코인방|사기꾼|자살)/i;
// Bình luận chỉ toàn "ㅋㅋㅋ" (cười) / "ㅠㅠ" (khóc) => bỏ qua, không đọc
const KO_JAMO_ONLY_RE = /^[\sㄱ-ㅎㅏ-ㅣ.!?~]+$/;

function isBlockedSpamOrToxic(raw) {
  if (!raw) return true;
  const s = String(raw);
  if (WEIRD_SPAM_RE.test(s)) return true;
  if (BAD_WORDS_RE.test(s)) return true;
  if (BAD_WORDS_KO_RE.test(s)) return true;
  if (KO_JAMO_ONLY_RE.test(s)) return true;
  return false;
}

function sanitizeUserName(rawName) {
  const normalized = String(rawName || '')
    .normalize('NFKC')
    .normalize('NFC')
    .replace(BRACKET_EMOTE_RE, ' ')
    .replace(ALLOWED_VI_NAME_RE, ' ')
    .replace(/(.)\1{3,}/gi, '$1$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 26);

  if (!normalized || BAD_WORDS_RE.test(normalized) || BAD_WORDS_KO_RE.test(normalized)) {
    return PACK.defaultName;
  }
  const letters = normalized.match(VI_LETTER_RE) || [];
  if (letters.length < 2 && !/[\uAC00-\uD7A3]/.test(normalized)) {
    return PACK.defaultName; // tên Hàn 1 âm tiết vẫn hợp lệ
  }
  return normalized;
}

function sanitizeWishText(rawWish) {
  if (!rawWish) return '';
  const cleaned = String(rawWish)
    .normalize('NFKC')
    .normalize('NFC')
    .replace(BRACKET_EMOTE_RE, ' ')
    .replace(/[ㄱ-ㅎㅏ-ㅣ]{2,}/g, ' ')
    .replace(ALLOWED_VI_TEXT_RE, ' ')
    .replace(/([.,!?])\1+/g, '$1')
    .replace(/(.)\1{2,}/gi, '$1$1')
    .replace(/\s+/g, ' ')
    .replace(/^[.,!?\s-]+|[.,!?\s-]+$/g, '')
    .slice(0, 120);

  if (!cleaned || BAD_WORDS_RE.test(cleaned) || BAD_WORDS_KO_RE.test(cleaned)) return '';
  const letters = cleaned.match(VI_LETTER_RE) || [];
  if (letters.length < 2) return '';
  return cleaned;
}

function recordDevotee(user, uniqueId, avatar, meritDelta, incenseDelta = 0, giftDelta = 0, wish = '') {
  const displayName = sanitizeUserName(user || uniqueId);
  const cleanWish = sanitizeWishText(wish);
  const key = (uniqueId || displayName).slice(0, 40);
  if (!state.devotees[key]) {
    state.devotees[key] = {
      name: displayName,
      uniqueId: uniqueId || displayName.toLowerCase().replace(/\s+/g, ''),
      avatar: avatar || '',
      merit: 0,
      incense: 0,
      gifts: 0,
      lastWish: ''
    };
  }
  const dev = state.devotees[key];
  dev.name = displayName;
  if (avatar) dev.avatar = avatar;
  dev.merit += meritDelta;
  dev.incense += incenseDelta;
  dev.gifts += giftDelta;
  if (cleanWish) dev.lastWish = cleanWish;

  state.totalMerit += meritDelta;
  state.haloIntensity = Math.min(1.0, 0.35 + (state.totalMerit % 1000) / 1400);
  return dev;
}

// 24/7: mỗi người vào phòng đều được ghi lại => sau nhiều tuần file state phình to, sắp xếp
// bảng xếp hạng chậm dần. Giữ tối đa MAX_DEVOTEES người có công đức cao nhất.
const MAX_DEVOTEES = Math.max(500, Number(process.env.MAX_DEVOTEES) || 5000);
function pruneDevotees() {
  const keys = Object.keys(state.devotees);
  if (keys.length <= MAX_DEVOTEES) return 0;
  const keep = keys
    .sort((a, b) => (state.devotees[b].merit || 0) - (state.devotees[a].merit || 0))
    .slice(0, Math.floor(MAX_DEVOTEES * 0.8));
  const next = {};
  for (const k of keep) next[k] = state.devotees[k];
  const removed = keys.length - keep.length;
  state.devotees = next;
  console.log(`[State] Dọn ${removed} thí chủ công đức thấp (giữ ${keep.length})`);
  return removed;
}

function pushEventLog(evt) {
  if (!evt.system) lastRitualAt = Date.now();
  const entry = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...evt
  };
  state.recentEvents.unshift(entry);
  if (state.recentEvents.length > 35) {
    state.recentEvents.length = 35;
  }
  return entry;
}

function getPublicState() {
  return {
    totalIncense: state.totalIncense,
    totalMerit: state.totalMerit,
    woodenFishHits: state.woodenFishHits,
    bellRings: state.bellRings,
    lanternCount: state.lanternCount,
    fortuneCount: state.fortuneCount,
    activeIncenseSticks: state.activeIncenseSticks,
    haloIntensity: state.haloIntensity,
    offerings: state.offerings,
    leaderboard: getLeaderboard(24),
    recentEvents: state.recentEvents.slice(0, 15),
    settings: state.settings,
    tiktok: state.tiktok,
    tts: zeroTts ? zeroTts.getStatus() : { ready: false, status: 'init', voice: TTS_DEFAULT_VOICE },
    room: { id: PACK.id, room: PACK.room, locale: PACK.locale, title: PACK.meta.title }
  };
}

// ============================================================================
// 4. NGHI THỨC TƯƠNG TÁC (RITUAL HANDLERS) — câu đọc lấy từ gói phòng (PACK.speech)
// ============================================================================
// Tên đọc lên: tiếng Hàn bỏ "_" và số đuôi (minji_kim99 => minji kim) cho tự nhiên
const sayName = (name) => (PACK.locale === 'ko' ? speakableName(name) : name);
let lastRitualAt = Date.now(); // dùng cho chế độ "tự giảng khi phòng vắng"

const Rituals = {
  burnIncense(params = {}) {
    const user = sanitizeUserName(params.user);
    const uniqueId = params.uniqueId || '';
    const avatar = params.avatar || '';
    const count = Math.max(1, Math.min(9, Number(params.count) || 3));
    const wish = sanitizeWishText(params.wish) || PACK.defaults.incenseWish;
    const merit = count * 5;

    state.totalIncense += count;
    state.activeIncenseSticks = Math.min(36, state.activeIncenseSticks + count);
    const devotee = recordDevotee(user, uniqueId, avatar, merit, count, 0, wish);

    const ttsText = params.readTts === false
      ? ''
      : PACK.speech.incense({ name: sayName(devotee.name), count, wish });

    const event = pushEventLog({
      type: 'burnIncense',
      user: devotee.name,
      uniqueId: devotee.uniqueId,
      avatar: devotee.avatar,
      count,
      merit,
      wish,
      ttsText,
      ttsVoice: currentVoice()
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  strikeWoodenFish(params = {}) {
    const user = sanitizeUserName(params.user);
    const uniqueId = params.uniqueId || '';
    const avatar = params.avatar || '';
    const count = Math.max(1, Math.min(50, Number(params.count) || 1));
    const merit = count;

    state.woodenFishHits += count;
    const devotee = recordDevotee(user, uniqueId, avatar, merit, 0, 0);

    const event = pushEventLog({
      type: 'strikeWoodenFish',
      user: devotee.name,
      uniqueId: devotee.uniqueId,
      avatar: devotee.avatar,
      count,
      merit,
      ttsText: params.ttsText || ''
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  ringBell(params = {}) {
    const user = sanitizeUserName(params.user);
    const uniqueId = params.uniqueId || '';
    const avatar = params.avatar || '';
    const count = Math.max(1, Math.min(9, Number(params.count) || 1));
    const wish = sanitizeWishText(params.wish) || PACK.defaults.bellWish;
    const merit = count * 10;

    state.bellRings += count;
    const devotee = recordDevotee(user, uniqueId, avatar, merit, 0, 0, wish);

    const ttsText = params.readTts
      ? PACK.speech.bell({ name: sayName(devotee.name), wish })
      : '';

    const event = pushEventLog({
      type: 'ringBell',
      user: devotee.name,
      uniqueId: devotee.uniqueId,
      avatar: devotee.avatar,
      count,
      merit,
      wish,
      ttsText,
      ttsVoice: currentVoice()
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  sendPrayer(params = {}) {
    const user = sanitizeUserName(params.user);
    const uniqueId = params.uniqueId || '';
    const avatar = params.avatar || '';
    const wish = sanitizeWishText(params.wish) || PACK.defaults.prayerWish;
    const merit = 10;

    state.lanternCount += 1;
    const devotee = recordDevotee(user, uniqueId, avatar, merit, 1, 0, wish);

    const ttsText = params.readTts === false
      ? ''
      : PACK.speech.prayer({ name: sayName(devotee.name), wish });

    const event = pushEventLog({
      type: 'sendPrayer',
      user: devotee.name,
      uniqueId: devotee.uniqueId,
      avatar: devotee.avatar,
      wish,
      merit,
      ttsText,
      ttsVoice: currentVoice()
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  offerGift(params = {}) {
    const user = sanitizeUserName(params.user);
    const uniqueId = params.uniqueId || '';
    const avatar = params.avatar || '';
    const coins = Math.max(1, Number(params.coins) || 10);
    const giftType = ['lotus', 'fruit', 'lamp', 'dragon'].includes(params.giftType)
      ? params.giftType
      : (coins >= 100 ? 'dragon' : coins >= 20 ? 'fruit' : coins >= 5 ? 'lamp' : 'lotus');

    const giftLabels = PACK.giftLabels;
    const giftName = params.giftName || giftLabels[giftType];
    const multiplier = coins >= 100 ? 50 : coins >= 10 ? 30 : 20;
    const merit = Math.max(20, coins * multiplier);

    state.offerings[giftType] = (state.offerings[giftType] || 0) + 1;
    state.totalIncense += 3;
    state.activeIncenseSticks = Math.min(36, state.activeIncenseSticks + 3);

    const wish = params.wish || PACK.defaults.giftWish(giftName);
    const devotee = recordDevotee(user, uniqueId, avatar, merit, 3, 1, wish);

    const ttsText = params.readTts === false
      ? ''
      : PACK.speech.gift({ name: sayName(devotee.name), gift: giftName, merit });

    const event = pushEventLog({
      type: giftType === 'dragon' ? 'grandCeremony' : 'offerGift',
      user: devotee.name,
      uniqueId: devotee.uniqueId,
      avatar: devotee.avatar,
      giftType,
      giftName,
      coins,
      merit,
      wish,
      ttsText,
      ttsVoice: currentVoice()
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  drawFortune(params = {}) {
    const user = sanitizeUserName(params.user);
    const uniqueId = params.uniqueId || '';
    const avatar = params.avatar || '';
    const topic = sanitizeWishText(params.topic) || PACK.defaults.topic;
    const fortune = FORTUNE_DECK[Math.floor(Math.random() * FORTUNE_DECK.length)];
    const merit = 10;

    state.fortuneCount += 1;
    const devotee = recordDevotee(user, uniqueId, avatar, merit, 0, 0, PACK.defaults.drawRecord(fortune));

    const ttsText = params.readTts === false
      ? ''
      : PACK.speech.draw({ name: sayName(devotee.name), card: fortune });

    const event = pushEventLog({
      type: 'drawFortune',
      user: devotee.name,
      uniqueId: devotee.uniqueId,
      avatar: devotee.avatar,
      topic,
      fortune,
      merit,
      ttsText,
      ttsVoice: currentVoice()
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  grandCeremony(params = {}) {
    return this.offerGift({
      ...params,
      giftType: 'dragon',
      coins: Math.max(100, Number(params.coins) || 199),
      giftName: params.giftName || PACK.grandName
    });
  },

  updateSettings(params = {}) {
    state.settings = {
      ...state.settings,
      ...params
    };
    if (typeof params.autoSim === 'boolean') {
      configureAutoSim(params.autoSim);
    }
    saveState();
    broadcastNotification('temple.state', getPublicState());
    return getPublicState();
  },

  resetMerit() {
    state.totalIncense = 9;
    state.totalMerit = 0;
    state.woodenFishHits = 0;
    state.bellRings = 0;
    state.lanternCount = 0;
    state.fortuneCount = 0;
    state.activeIncenseSticks = 3;
    state.offerings = { lotus: 1, fruit: 1, lamp: 1, dragon: 0 };
    state.devotees = {};
    state.recentEvents = [];
    saveState();
    broadcastNotification('temple.state', getPublicState());
    return getPublicState();
  }
};

// ============================================================================
// 5. TIKTOK LIVE CONNECTOR & COMMENT PARSER
// ============================================================================
let tiktokConn = null;

const commentCooldownMap = new Map();

function parseViewerComment(commentText, user, uniqueId, avatar) {
  const raw = String(commentText || '').trim();
  if (!raw || isBlockedSpamOrToxic(raw)) {
    return null;
  }

  const cleanWish = sanitizeWishText(raw);
  if (!cleanWish || cleanWish.length < (PACK.locale === 'ko' ? 2 : 3)) {
    return null;
  }

  // Chống 1 người spam bình luận liên tục làm nghẽn hàng đợi TTS (cooldown 3.5 giây/người)
  const userKey = uniqueId || user || '';
  const now = Date.now();
  if (userKey) {
    const lastTs = commentCooldownMap.get(userKey) || 0;
    if (now - lastTs < 3500) {
      return null;
    }
    commentCooldownMap.set(userKey, now);
    if (commentCooldownMap.size > 600) {
      const oldestKey = commentCooldownMap.keys().next().value;
      commentCooldownMap.delete(oldestKey);
    }
  }

  const cleanUser = sanitizeUserName(user);
  // So khớp trên cả bản gốc lẫn bản đã lọc
  const lower = `${raw} ${cleanWish}`.toLowerCase();
  const has = (list) => list.some((kw) => lower.includes(String(kw).toLowerCase()));
  const kw = PACK.keywords;

  // 1. Xin xăm / Lời Phật dạy / Câu Kinh Thánh hôm nay
  if (has(kw.fortune)) {
    return Rituals.drawFortune({ user: cleanUser, uniqueId, avatar, topic: cleanWish });
  }
  // 2. Thỉnh chuông
  if (has(kw.bell)) {
    return Rituals.ringBell({ user: cleanUser, uniqueId, avatar, count: 1, wish: cleanWish, readTts: true });
  }
  // 3. Gõ mõ / Amen
  if (has(kw.woodenFish)) {
    return Rituals.strikeWoodenFish({ user: cleanUser, uniqueId, avatar, count: 3 });
  }
  // 4. Thắp hương / Thắp nến
  if (has(kw.incense)) {
    return Rituals.burnIncense({ user: cleanUser, uniqueId, avatar, count: 3, wish: cleanWish });
  }
  // 5. Cầu nguyện / Thả đèn / Ý cầu nguyện
  if (has(kw.prayer)) {
    return Rituals.sendPrayer({ user: cleanUser, uniqueId, avatar, wish: cleanWish });
  }

  return Rituals.burnIncense({ user: cleanUser, uniqueId, avatar, count: 1, wish: cleanWish });
}

const giftComboTracker = new Map();

async function resolveTikTokUsername(rawInput) {
  let input = String(rawInput || '').trim();
  if (!input) {
    throw new Error('Vui lòng nhập @username hoặc link TikTok Live cần kết nối');
  }
  if (input.startsWith('http://') || input.startsWith('https://') || input.includes('tiktok.com/')) {
    const urlToFetch = input.startsWith('http') ? input : `https://${input}`;
    const directMatch = urlToFetch.match(/tiktok\.com\/@([^/?#]+)/i);
    if (directMatch && directMatch[1]) {
      return directMatch[1];
    }
    try {
      const resp = await fetch(urlToFetch, { redirect: 'follow' });
      const finalUrl = resp.url || '';
      const resolvedMatch = finalUrl.match(/tiktok\.com\/@([^/?#]+)/i);
      if (resolvedMatch && resolvedMatch[1]) {
        return resolvedMatch[1];
      }
    } catch (e) {
      console.warn('[TikTok URL Resolve Warning]', e.message);
    }
  }
  return input.replace(/^@/, '').split(/[/?#]/)[0].trim();
}

function extractUserFromEvent(data) {
  const u = data?.user || data || {};
  const uniqueId = u.uniqueId || u.displayId || data?.uniqueId || '';
  const user = u.nickname || uniqueId || data?.nickname || PACK.defaultName;
  const avatar =
    u.profilePictureUrl ||
    u.avatarLarge?.urlList?.[0] ||
    u.avatarThumb?.urlList?.[0] ||
    u.avatarMedium?.urlList?.[0] ||
    data?.profilePictureUrl ||
    '';
  return { user, uniqueId, avatar };
}

// ----------------------------------------------------------------------------
// 24/7: TỰ ĐỘNG KẾT NỐI LẠI PHÒNG LIVE
//  - Mất mạng, TikTok ngắt WebSocket, phiên Live kết thúc rồi phát lại... => tự thử lại
//  - Độ trễ tăng dần 15s → 30s → 60s → ... tối đa 5 phút (tránh bị TikTok chặn vì gọi dồn dập)
//  - Chỉ dừng khi người vận hành chủ động gọi live.disconnect
// ----------------------------------------------------------------------------
const RECONNECT_MIN_MS = 15 * 1000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
const liveKeeper = {
  wantedUser: null,
  delayMs: RECONNECT_MIN_MS,
  timer: null,
  attempts: 0,
  connectStartedAt: 0
};

function scheduleTikTokReconnect(reason) {
  if (!liveKeeper.wantedUser || liveKeeper.timer) return;
  const delay = liveKeeper.delayMs;
  liveKeeper.delayMs = Math.min(RECONNECT_MAX_MS, liveKeeper.delayMs * 2);
  liveKeeper.attempts += 1;
  console.log(
    `[TikTok Live] ${reason || 'Mất kết nối'} — thử lại @${liveKeeper.wantedUser} sau ${Math.round(delay / 1000)}s (lần ${liveKeeper.attempts})`
  );
  liveKeeper.timer = setTimeout(() => {
    liveKeeper.timer = null;
    if (!liveKeeper.wantedUser || state.tiktok.connected || state.tiktok.connecting) return;
    connectTikTokLive(liveKeeper.wantedUser).catch((err) => {
      scheduleTikTokReconnect(`Kết nối thất bại: ${err.message}`);
    });
  }, delay);
}

// Lưới an toàn: cứ 60s kiểm tra, nếu đáng lẽ phải kết nối mà không có gì đang chạy thì lên lịch lại
setInterval(() => {
  if (!liveKeeper.wantedUser) return;
  // Kết nối bị treo quá 2 phút => huỷ và thử lại
  if (state.tiktok.connecting && Date.now() - liveKeeper.connectStartedAt > 2 * 60 * 1000) {
    console.warn('[TikTok Live] Kết nối bị treo quá 2 phút, huỷ để thử lại');
    const stuck = tiktokConn;
    tiktokConn = null;
    try {
      stuck?.disconnect();
    } catch (_) {}
    state.tiktok.connecting = false;
  }
  if (!state.tiktok.connected && !state.tiktok.connecting && !liveKeeper.timer) {
    scheduleTikTokReconnect('Watchdog phát hiện chưa kết nối');
  }
}, 60 * 1000).unref();

async function connectTikTokLive(usernameOrUrl) {
  const cleanUser = await resolveTikTokUsername(usernameOrUrl);
  if (!cleanUser) {
    throw new Error('Không tìm thấy @username hợp lệ từ dữ liệu nhập vào');
  }
  liveKeeper.wantedUser = cleanUser;
  liveKeeper.connectStartedAt = Date.now();
  clearTimeout(liveKeeper.timer);
  liveKeeper.timer = null;

  if (tiktokConn) {
    const old = tiktokConn;
    tiktokConn = null; // đặt null TRƯỚC để sự kiện DISCONNECTED của kết nối cũ không kích hoạt thử lại
    try {
      await old.disconnect();
    } catch (_) {}
  }

  state.tiktok = {
    connected: false,
    connecting: true,
    username: cleanUser,
    roomId: null,
    viewerCount: 0,
    lastError: null
  };
  broadcastNotification('temple.state', getPublicState());

  const conn = new TikTokLiveConnection(cleanUser, {
    processInitialData: true,
    fetchRoomInfoOnConnect: false,
    enableExtendedGiftInfo: false
  });
  tiktokConn = conn;

  tiktokConn.on(ControlEvent.CONNECTED, (roomState) => {
    liveKeeper.delayMs = RECONNECT_MIN_MS;
    liveKeeper.attempts = 0;
    state.tiktok.connected = true;
    state.tiktok.connecting = false;
    state.tiktok.roomId = roomState?.roomId || tiktokConn?.roomId || null;
    state.tiktok.lastError = null;
    console.log(`[TikTok Live] Đã kết nối phòng @${cleanUser} (roomId: ${state.tiktok.roomId})`);
    broadcastNotification('temple.state', getPublicState());
  });

  tiktokConn.on(ControlEvent.DISCONNECTED, () => {
    if (tiktokConn !== conn) return; // kết nối cũ đã bị thay thế
    state.tiktok.connected = false;
    state.tiktok.connecting = false;
    console.log(`[TikTok Live] Đã ngắt kết nối @${cleanUser}`);
    broadcastNotification('temple.state', getPublicState());
    scheduleTikTokReconnect('Bị ngắt kết nối');
  });

  // Phiên Live kết thúc (chủ phòng tắt Live / TikTok cắt luồng) => chờ rồi thử vào lại
  tiktokConn.on(WebcastEvent.STREAM_END, () => {
    if (tiktokConn !== conn) return;
    console.log(`[TikTok Live] Phiên Live của @${cleanUser} đã kết thúc`);
    state.tiktok.connected = false;
    state.tiktok.connecting = false;
    broadcastNotification('temple.state', getPublicState());
    try {
      conn.disconnect();
    } catch (_) {}
    scheduleTikTokReconnect('Phiên Live kết thúc');
  });

  tiktokConn.on(ControlEvent.ERROR, (err) => {
    let msg = err?.message || err?.info || err?.exception?.message;
    if (!msg) {
      try {
        msg = typeof err === 'object' ? JSON.stringify(err).slice(0, 300) : String(err);
      } catch (_) {
        msg = String(err);
      }
    }
    state.tiktok.lastError = msg;
    console.warn('[TikTok Live Warning]', state.tiktok.lastError);
    broadcastNotification('temple.state', getPublicState());
  });

  tiktokConn.on(WebcastEvent.ROOM_USER, (data) => {
    const viewerCount = Number(data?.total ?? data?.viewerCount ?? 0);
    if (viewerCount > 0) {
      state.tiktok.viewerCount = viewerCount;
      broadcastNotification('temple.viewerCount', { viewerCount });
    }
  });

  tiktokConn.on(WebcastEvent.MEMBER, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    recordDevotee(user, uniqueId, avatar, 1, 0, 0, PACK.defaults.memberWish);
    broadcastNotification('temple.state', getPublicState());
  });

  tiktokConn.on(WebcastEvent.CHAT, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    const commentText = data?.content || data?.comment || '';
    console.log(`[TikTok Chat] ${user}: ${commentText}`);
    parseViewerComment(commentText, user, uniqueId, avatar);
  });

  tiktokConn.on(WebcastEvent.LIKE, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    const likeCount = Math.min(15, Math.max(1, Number(data?.count ?? data?.likeCount ?? 1)));
    Rituals.strikeWoodenFish({ user, uniqueId, avatar, count: likeCount });
  });

  const handleSocialEvent = (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    Rituals.ringBell({
      user,
      uniqueId,
      avatar,
      count: 1,
      wish: PACK.defaults.followWish,
      readTts: false
    });
    queueFollowGreeting(user);
  };
  tiktokConn.on(WebcastEvent.FOLLOW, handleSocialEvent);
  tiktokConn.on(WebcastEvent.SHARE, handleSocialEvent);
  tiktokConn.on(WebcastEvent.SOCIAL, (data) => {
    const action = String(data?.action || '');
    const disp = String(data?.common?.displayText?.displayType || data?.displayType || '').toLowerCase();
    if (action === '1' || action === '3' || disp.includes('follow') || disp.includes('share')) {
      handleSocialEvent(data);
    }
  });

  tiktokConn.on(WebcastEvent.GIFT, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    const giftObj = data?.gift || data?.giftDetails || {};
    const giftId = String(data?.giftId || giftObj?.id || 'rose');
    const groupId = String(data?.groupId || `${uniqueId}_${giftId}`);
    const repeatCount = Math.max(1, Number(data?.repeatCount || data?.comboCount || 1));

    const prevCount = giftComboTracker.get(groupId) || 0;
    if (repeatCount <= prevCount && data?.repeatEnd) {
      giftComboTracker.delete(groupId);
      return;
    }
    const deltaCount = Math.max(1, repeatCount - prevCount);
    giftComboTracker.set(groupId, repeatCount);
    if (giftComboTracker.size > 500) {
      const firstKey = giftComboTracker.keys().next().value;
      giftComboTracker.delete(firstKey);
    }

    const diamondCount = Math.max(1, Number(giftObj?.diamondCount || data?.diamondCount || 1));
    const totalCoins = diamondCount * deltaCount;
    const rawGiftName = giftObj?.name || data?.giftName || giftObj?.describe || PACK.defaults.tiktokGiftFallbackName;
    const displayGiftName = deltaCount > 1 ? `${deltaCount}x ${rawGiftName}` : rawGiftName;

    console.log(`[TikTok Gift] ${user} gửi ${displayGiftName} (${totalCoins} xu)`);

    Rituals.offerGift({
      user,
      uniqueId,
      avatar,
      coins: totalCoins,
      giftName: displayGiftName,
      wish: PACK.defaults.tiktokGiftWish(displayGiftName)
    });
  });

  try {
    const roomState = await tiktokConn.connect();
    state.tiktok.connected = true;
    state.tiktok.connecting = false;
    state.tiktok.roomId = roomState?.roomId || tiktokConn?.roomId || null;
    broadcastNotification('temple.state', getPublicState());
    return state.tiktok;
  } catch (err) {
    if (tiktokConn !== conn) throw err; // đã có lần kết nối mới thay thế
    state.tiktok.connected = false;
    state.tiktok.connecting = false;
    state.tiktok.lastError = err?.message || 'Không thể kết nối phòng Live (kiểm tra tài khoản đang phát Live chưa)';
    broadcastNotification('temple.state', getPublicState());
    scheduleTikTokReconnect(`Kết nối thất bại: ${state.tiktok.lastError}`);
    throw new Error(state.tiktok.lastError);
  }
}

function disconnectTikTokLive() {
  // Người vận hành chủ động ngắt => KHÔNG tự kết nối lại nữa
  liveKeeper.wantedUser = null;
  clearTimeout(liveKeeper.timer);
  liveKeeper.timer = null;
  if (tiktokConn) {
    const old = tiktokConn;
    tiktokConn = null;
    try {
      old.disconnect();
    } catch (_) {}
  }
  state.tiktok.connected = false;
  state.tiktok.connecting = false;
  state.tiktok.viewerCount = 0;
  broadcastNotification('temple.state', getPublicState());
  return state.tiktok;
}

// ============================================================================
// 6. AUTO-SIMULATION ENGINE (CHẾ ĐỘ TỰ ĐỘNG GIẢ LẬP ĐÔNG NGƯỜI XEM)
// ============================================================================
let autoSimTimer = null;
const SIM_DEVOTEES = PACK.sim;

function runSingleSimulationStep() {
  const pick = SIM_DEVOTEES[Math.floor(Math.random() * SIM_DEVOTEES.length)];
  const roll = Math.random();
  if (roll < 0.30) {
    Rituals.burnIncense({ user: pick.user, uniqueId: pick.uniqueId, count: 3, wish: pick.wish });
  } else if (roll < 0.55) {
    Rituals.sendPrayer({ user: pick.user, uniqueId: pick.uniqueId, wish: pick.wish });
  } else if (roll < 0.75) {
    Rituals.drawFortune({ user: pick.user, uniqueId: pick.uniqueId, topic: pick.wish });
  } else if (roll < 0.90) {
    Rituals.offerGift({ user: pick.user, uniqueId: pick.uniqueId, giftType: 'lotus', coins: 15, giftName: PACK.simGiftName });
  } else {
    Rituals.ringBell({ user: pick.user, uniqueId: pick.uniqueId, count: 1, wish: pick.wish, readTts: true });
  }
}

function configureAutoSim(enabled) {
  state.settings.autoSim = Boolean(enabled);
  if (autoSimTimer) {
    clearInterval(autoSimTimer);
    autoSimTimer = null;
  }
  if (state.settings.autoSim) {
    runSingleSimulationStep();
    autoSimTimer = setInterval(runSingleSimulationStep, state.settings.autoSimIntervalMs || 9500);
  }
}

// ============================================================================
// 6B. VẬN HÀNH 24/7 "VIP": LỊCH LỄ THEO GIỜ ĐỊA PHƯƠNG, TỰ GIẢNG KHI VẮNG, CHÀO NGƯỜI THEO DÕI
//  - Không bao giờ dùng tên người xem giả: chỉ là lời chủ phòng nói (system event).
// ============================================================================
const ROOM_TZ = process.env.ROOM_TZ || PACK.meta.timeZone || 'Asia/Seoul';
const IDLE_TALK_MINUTES = Number(process.env.IDLE_TALK_MINUTES ?? 5);
const zonedNow = (date = new Date()) => zonedNowIn(ROOM_TZ, date);

function broadcastSystemEvent(evt) {
  const event = pushEventLog({ ...evt, system: true, ttsVoice: currentVoice() });
  broadcastNotification('temple.event', { event, state: getPublicState() });
  return event;
}

function fireScheduleItem(item) {
  console.log(`[Lịch lễ] ${item.time} ${item.title}`);
  state.bellRings += item.bells || 1;
  saveState();
  return broadcastSystemEvent({
    type: 'announce',
    user: item.title,
    title: item.title,
    bells: Math.max(1, Math.min(9, item.bells || 1)),
    ttsText: state.settings.ttsEnabled === false ? '' : item.text
  });
}

const firedSchedule = new Set();
function checkSchedule(now = zonedNow()) {
  for (const item of PACK.schedule || []) {
    if (!isScheduleDue(item, now)) continue;
    const key = `${now.date} ${item.time} ${item.title}`;
    if (firedSchedule.has(key)) continue;
    firedSchedule.add(key);
    if (firedSchedule.size > 200) firedSchedule.delete(firedSchedule.values().next().value);
    fireScheduleItem(item);
  }
}
setInterval(() => checkSchedule(), 15 * 1000).unref();

// Phòng vắng quá IDLE_TALK_MINUTES phút => đọc 1 lời dạy / câu Kinh Thánh hoặc lời mời tương tác.
// Màn hình không bao giờ "đứng hình" quá lâu — điều TikTok hay đánh giá thấp ở phòng live 24/7.
let idleTalkIndex = 0;
const idleEnabled = () => typeof PACK.speech.idle === 'function' || (PACK.idleTalks || []).length > 0;
function runIdleTalk() {
  if (!idleEnabled()) return null;
  const talks = PACK.idleTalks || [];
  idleTalkIndex += 1;
  // Xen kẽ: 2 lần đọc lời dạy, 1 lần lời mời tương tác (gói không có speech.idle => chỉ đọc lời nhắc)
  const deckTurn = typeof PACK.speech.idle === 'function' && !(talks.length && idleTalkIndex % 3 === 0);
  if (!deckTurn) {
    if (!talks.length) return null;
    const text = talks[idleTalkIndex % talks.length];
    return broadcastSystemEvent({ type: 'idleTalk', user: PACK.defaultName, ttsText: text });
  }
  const card = FORTUNE_DECK[Math.floor(Math.random() * FORTUNE_DECK.length)];
  return broadcastSystemEvent({
    type: 'idleTalk',
    user: PACK.defaultName,
    card,
    ttsText: PACK.speech.idle({ card })
  });
}
setInterval(() => {
  if (!(IDLE_TALK_MINUTES > 0) || !idleEnabled()) return;
  if (state.settings.autoSim) return;
  if (wss.clients.size === 0) return; // không có màn hình OBS nào đang mở
  if (Date.now() - lastRitualAt < IDLE_TALK_MINUTES * 60 * 1000) return;
  lastRitualAt = Date.now();
  runIdleTalk();
}, 20 * 1000).unref();

// "Thu sẵn" mọi câu cố định của phòng (không chứa tên người xem) => về sau đọc lại không tốn tiền/thời gian
function staticSpeechLines() {
  const lines = new Set();
  for (const t of PACK.idleTalks || []) lines.add(t);
  if (typeof PACK.speech.idle === 'function') {
    for (const card of FORTUNE_DECK) lines.add(PACK.speech.idle({ card }));
  }
  for (const item of PACK.schedule || []) if (item.text) lines.add(item.text);
  return [...lines];
}
let pregenRunning = null;
async function pregenerateStaticSpeech() {
  if (pregenRunning) return { running: true };
  const lines = staticSpeechLines();
  const report = { total: lines.length, ok: 0, cached: 0, failed: 0, chars: 0, engine: TTS_ENGINE, files: [] };
  pregenRunning = (async () => {
    for (const text of lines) {
      const res = await zeroTts.synthesize(text);
      if (res.ok && res.file) report.files.push(res.file);
      if (!res.ok) report.failed += 1;
      else if (res.cached) report.cached += 1;
      else {
        report.ok += 1;
        report.chars += text.length;
      }
    }
  })();
  try {
    await pregenRunning;
  } finally {
    pregenRunning = null;
  }
  console.log(`[TTS] Thu sẵn câu cố định: ${JSON.stringify(report)}`);
  return report;
}

// Chào người mới theo dõi: gom tên trong 6 giây, tối đa 1 lời chào / 20 giây (tránh nghẽn giọng đọc)
const followQueue = [];
let followTimer = null;
let lastFollowGreetAt = 0;
function formatNames(list) {
  const shown = list.slice(0, 3).map(sayName);
  if (PACK.locale === 'ko') {
    const base = shown.map((n) => `${n}님`).join(', ');
    return list.length > 3 ? `${base} 외 ${list.length - 3}분` : base;
  }
  const base = shown.join(', ');
  return list.length > 3 ? `${base} và ${list.length - 3} người khác` : base;
}
function flushFollowGreeting() {
  followTimer = null;
  if (!followQueue.length || typeof PACK.speech.follow !== 'function') return;
  const wait = 20 * 1000 - (Date.now() - lastFollowGreetAt);
  if (wait > 0) {
    followTimer = setTimeout(flushFollowGreeting, wait);
    return;
  }
  const names = followQueue.splice(0, followQueue.length);
  lastFollowGreetAt = Date.now();
  broadcastSystemEvent({
    type: 'welcome',
    user: names[0],
    names: names.slice(0, 3),
    ttsText: state.settings.ttsEnabled === false ? '' : PACK.speech.follow({ names: formatNames(names) })
  });
}
function queueFollowGreeting(rawUser) {
  if (typeof PACK.speech.follow !== 'function') return;
  const name = sanitizeUserName(rawUser);
  if (!name || name === PACK.defaultName || followQueue.includes(name)) return;
  followQueue.push(name);
  if (followQueue.length > 30) followQueue.shift();
  if (!followTimer) followTimer = setTimeout(flushFollowGreeting, 6000);
}

// ============================================================================
// 7. JSON-RPC 2.0 DISPATCHER
// ============================================================================
async function handleRpcCall(method, params = {}) {
  switch (method) {
    case 'temple.getState':
      return getPublicState();
    case 'temple.burnIncense':
      return Rituals.burnIncense(params);
    case 'temple.strikeWoodenFish':
      return Rituals.strikeWoodenFish(params);
    case 'temple.ringBell':
      return Rituals.ringBell(params);
    case 'temple.sendPrayer':
      return Rituals.sendPrayer(params);
    case 'temple.offerGift':
      return Rituals.offerGift(params);
    case 'temple.drawFortune':
      return Rituals.drawFortune(params);
    case 'temple.grandCeremony':
      return Rituals.grandCeremony(params);
    case 'temple.updateSettings':
      return Rituals.updateSettings(params);
    case 'temple.resetMerit':
      return Rituals.resetMerit();
    case 'temple.comment':
      return parseViewerComment(params.comment, params.user, params.uniqueId, params.avatar);
    case 'temple.speak': {
      const res = await zeroTts.synthesize(params.text, params.voice || currentVoice());
      if (res.ok && params.broadcast !== false) {
        broadcastNotification('tts.play', {
          text: params.text,
          voice: res.voice,
          url: res.url
        });
      }
      return res;
    }
    case 'temple.ttsStatus':
      return zeroTts.getStatus();
    case 'live.connect':
      return await connectTikTokLive(params.username);
    case 'live.disconnect':
      return disconnectTikTokLive();
    case 'room.getPack':
      return clientPack(PACK);
    case 'room.announce': {
      // Thử một mục lịch lễ ngay lập tức: params.index (mặc định 0)
      const list = PACK.schedule || [];
      if (!list.length) throw new Error('Gói phòng này không có lịch lễ');
      return fireScheduleItem(list[Math.max(0, Math.min(list.length - 1, Number(params.index) || 0))]);
    }
    case 'room.idleTalk':
      return runIdleTalk();
    case 'room.pregenerate':
      return pregenerateStaticSpeech();
    case 'room.followTest':
      queueFollowGreeting(params.user || 'Test');
      return { queued: followQueue.length };
    case 'live.setAutoSim':
      configureAutoSim(Boolean(params.enabled));
      saveState();
      broadcastNotification('temple.state', getPublicState());
      return getPublicState();
    default:
      throw new Error(`Không tìm thấy phương thức JSON-RPC: ${method}`);
  }
}

// ============================================================================
// 8. EXPRESS + WEBSOCKET SERVER
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/tts-cache', express.static(TTS_CACHE_DIR, { maxAge: '7d' }));

// Trang chính "/" = trang của gói phòng đang chạy (chùa: index.html, nhà thờ: church.html)
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', PACK.meta.page || 'index.html'));
});
// Gói câu chữ cho trình duyệt — nạp đồng bộ bằng <script src="/api/pack.js"> trước live.js
app.get('/api/pack.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache');
  res.send(`window.ROOM_PACK = ${JSON.stringify(clientPack(PACK))};`);
});
app.get('/api/pack', (_req, res) => res.json(clientPack(PACK)));
// Thư viện 3D Three.js cho phòng Nhà thờ (phục vụ thẳng từ node_modules, không cần Internet/CDN)
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
app.use('/vendor/three/addons', express.static(path.join(THREE_DIR, 'examples', 'jsm'), { maxAge: '30d' }));
app.use('/vendor/three', express.static(path.join(THREE_DIR, 'build'), { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// HTTP JSON-RPC 2.0 Endpoint
app.post('/rpc', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};
  if (!method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid JSON-RPC Request: thiếu method' }
    });
  }
  try {
    const result = await handleRpcCall(method, params || {});
    res.json({
      jsonrpc: jsonrpc || '2.0',
      id: id ?? null,
      result
    });
  } catch (err) {
    res.status(200).json({
      jsonrpc: jsonrpc || '2.0',
      id: id ?? null,
      error: { code: -32000, message: err.message || 'Server error' }
    });
  }
});

// ZeroTTS HTTP Endpoint (Mai Chi default)
app.all('/api/tts', async (req, res) => {
  const text = (req.body?.text || req.query?.text || '').trim();
  const voice = String(req.body?.voice || req.query?.voice || currentVoice()).trim();
  if (!text) {
    return res.status(400).json({ ok: false, error: 'Thiếu nội dung text cần đọc' });
  }
  const result = await zeroTts.synthesize(text, voice);
  res.json(result);
});

app.get('/api/state', (_req, res) => {
  res.json(getPublicState());
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastNotification(method, params) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params
  });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'temple.state',
      params: getPublicState()
    })
  );

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch (_) {
      return;
    }
    if (!msg || !msg.method) return;
    try {
      const result = await handleRpcCall(msg.method, msg.params || {});
      if (msg.id !== undefined) {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result
          })
        );
      }
    } catch (err) {
      if (msg.id !== undefined) {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32000, message: err.message || 'RPC Error' }
          })
        );
      }
    }
  });
});

const zeroTts = new ZeroTTSManager();

// ============================================================================
// 9. VẬN HÀNH 24/7: HEALTHCHECK, DỌN RÁC, BẮT LỖI, TẮT AN TOÀN
// ============================================================================
const BOOT_AT = Date.now();
app.get('/healthz', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000),
    rssMB: Math.round(mem.rss / 1048576),
    heapMB: Math.round(mem.heapUsed / 1048576),
    wsClients: wss.clients.size,
    devotees: Object.keys(state.devotees).length,
    tiktok: {
      connected: state.tiktok.connected,
      connecting: state.tiktok.connecting,
      username: state.tiktok.username,
      reconnectAttempts: liveKeeper.attempts,
      lastError: state.tiktok.lastError
    },
    tts: zeroTts.getStatus().status
  });
});

// Bộ đệm giọng đọc: mỗi câu khấn tạo 1 file WAV => chạy 24/7 sẽ đầy ổ cứng nếu không dọn
const TTS_CACHE_MAX_AGE_MS = (Number(process.env.TTS_CACHE_MAX_AGE_HOURS) || 24) * 3600 * 1000;
const TTS_CACHE_MAX_FILES = Number(process.env.TTS_CACHE_MAX_FILES) || 3000;
// File giọng Vibi là file TRẢ TIỀN => giữ lâu hơn (mặc định 60 ngày) và không tính vào giới hạn số file.
// Nhờ vậy các câu cố định (lời dạy, câu Kinh Thánh, giờ lễ) chỉ "thu" 1 lần rồi dùng lại mãi.
const PAID_CACHE_MAX_AGE_MS = (Number(process.env.VIBI_CACHE_DAYS) || 60) * 24 * 3600 * 1000;
const isPaidAudio = (name) => name.startsWith('vibi_');
async function cleanTtsCache() {
  try {
    const names = await fs.promises.readdir(TTS_CACHE_DIR);
    const files = [];
    for (const name of names) {
      const full = path.join(TTS_CACHE_DIR, name);
      try {
        const st = await fs.promises.stat(full);
        if (!st.isFile()) continue;
        if (isPaidAudio(name)) {
          if (Date.now() - st.mtimeMs > PAID_CACHE_MAX_AGE_MS) await fs.promises.unlink(full).catch(() => {});
          continue;
        }
        files.push({ full, mtime: st.mtimeMs });
      } catch (_) {}
    }
    files.sort((a, b) => b.mtime - a.mtime); // mới nhất trước
    const now = Date.now();
    let removed = 0;
    for (let i = 0; i < files.length; i++) {
      if (i >= TTS_CACHE_MAX_FILES || now - files[i].mtime > TTS_CACHE_MAX_AGE_MS) {
        await fs.promises.unlink(files[i].full).catch(() => {});
        removed++;
      }
    }
    if (removed) console.log(`[TTS Cache] Đã dọn ${removed} file cũ (còn ${files.length - removed})`);
  } catch (e) {
    console.warn('[TTS Cache] Lỗi dọn bộ đệm:', e.message);
  }
}
setInterval(cleanTtsCache, 30 * 60 * 1000).unref();

// Giọng THU SẴN đi kèm mã nguồn (thư mục voice-prerecorded/, tạo bằng npm run pregen rồi commit).
// Khi khởi động: chép vào bộ đệm => máy mới (vd. MacBook) phát ngay các câu cố định, không tốn credit.
// Tên file chứa mã băm của (giọng + mẫu giọng + ngôn ngữ + câu chữ) => đổi giọng thì file cũ tự không dùng.
const PRERECORDED_DIR = path.join(__dirname, 'voice-prerecorded');
function seedPrerecordedVoice() {
  try {
    if (!fs.existsSync(PRERECORDED_DIR)) return;
    let copied = 0;
    for (const name of fs.readdirSync(PRERECORDED_DIR)) {
      if (!/\.(mp3|wav)$/i.test(name)) continue;
      const dest = path.join(TTS_CACHE_DIR, name);
      if (fs.existsSync(dest)) {
        const now = new Date();
        fs.utimesSync(dest, now, now); // làm mới để không bị dọn
        continue;
      }
      fs.copyFileSync(path.join(PRERECORDED_DIR, name), dest);
      copied++;
    }
    if (copied) console.log(`[TTS] Đã nạp ${copied} câu thu sẵn từ voice-prerecorded/`);
  } catch (e) {
    console.warn('[TTS] Không nạp được giọng thu sẵn:', e.message);
  }
}
seedPrerecordedVoice();
setInterval(seedPrerecordedVoice, 24 * 3600 * 1000).unref();
setTimeout(cleanTtsCache, 60 * 1000).unref();

// Ghi nhật ký bộ nhớ mỗi giờ để phát hiện rò rỉ khi chạy dài ngày
setInterval(() => {
  const mem = process.memoryUsage();
  console.log(
    `[Health] uptime ${Math.round((Date.now() - BOOT_AT) / 3600000)}h • RSS ${Math.round(mem.rss / 1048576)}MB • ` +
      `ws ${wss.clients.size} • TikTok ${state.tiktok.connected ? 'ON' : 'OFF'} • TTS ${zeroTts.status}`
  );
}, 60 * 60 * 1000).unref();

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Promise bị từ chối không được xử lý:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  // Trạng thái tiến trình không còn đáng tin => lưu dữ liệu rồi thoát để PM2/systemd khởi động lại sạch sẽ
  console.error('[Process] Lỗi nghiêm trọng, khởi động lại:', err);
  shutdown(1);
});

function writeStateSync() {
  try {
    pruneDevotees();
    const toSave = {
      totalIncense: state.totalIncense,
      totalMerit: state.totalMerit,
      woodenFishHits: state.woodenFishHits,
      bellRings: state.bellRings,
      lanternCount: state.lanternCount,
      fortuneCount: state.fortuneCount,
      activeIncenseSticks: state.activeIncenseSticks,
      offerings: state.offerings,
      devotees: state.devotees,
      settings: state.settings
    };
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error('[State] Không lưu được khi tắt:', e.message);
  }
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[Process] Đang tắt an toàn: lưu Bảng Vàng Công Đức, dừng TTS, ngắt TikTok...');
  clearTimeout(saveTimer);
  writeStateSync();
  zeroTts.stop();
  liveKeeper.wantedUser = null;
  try {
    tiktokConn?.disconnect();
  } catch (_) {}
  server.close();
  setTimeout(() => process.exit(code), 800).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

server.listen(PORT, () => {
  console.log(`============================================================`);
  console.log(`🪷 ${PACK.meta.title} — gói ${PACK.id} — đã khởi động`);
  console.log(`🗣️  Giọng đọc: ${TTS_ENGINE} (${TTS_DEFAULT_VOICE}) • Múi giờ lịch lễ: ${ROOM_TZ} (${zonedNow().time})`);
  console.log(`📺 Màn hình Live (9:16 OBS): http://localhost:${PORT}`);
  console.log(`🎛️ Bảng điều khiển RPC Admin: http://localhost:${PORT}/admin`);
  console.log(`🔌 JSON-RPC 2.0 Endpoint   : http://localhost:${PORT}/rpc (ws://localhost:${PORT}/ws)`);
  console.log(`============================================================`);

  // Tự động kết nối tới @zenfacts_vn ngay khi khởi động server
  const defaultChannel = process.env.TIKTOK_USER || state.tiktok?.username || 'zenfacts_vn';
  if (defaultChannel) {
    connectTikTokLive(defaultChannel).catch((err) => {
      console.warn(`[Auto-Connect @${defaultChannel}] Chưa kết nối được ngay:`, err.message);
      scheduleTikTokReconnect('Kết nối lần đầu thất bại');
    });
  }
});
