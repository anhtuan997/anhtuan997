#!/usr/bin/env node
/**
 * Tìm giọng hay trên Vibi (https://vibi.pro) và nghe thử — không cần cài thêm gì (Node.js >= 18).
 *
 *   VIBI_API_KEY=xxx node tools/vibi-voices.js                      # giọng NỮ tiếng HÀN, cả 3 nhà cung cấp
 *   VIBI_API_KEY=xxx node tools/vibi-voices.js --lang vi            # giọng nữ tiếng Việt
 *   VIBI_API_KEY=xxx node tools/vibi-voices.js --gender male --limit 40
 *   VIBI_API_KEY=xxx node tools/vibi-voices.js --say "나무아미타불. 김민지님, 감사합니다." \
 *        --voice <voice_id> --provider elevenlabs                    # tạo file nghe thử bằng câu của bạn
 *
 * Kết quả: bảng trong cửa sổ lệnh + trang data/vibi-voices.html (bấm nghe thử từng giọng,
 * có sẵn dòng cấu hình để dán vào ecosystem.config.cjs). Windows (cmd): set VIBI_API_KEY=xxx trước.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const BASE = (process.env.VIBI_BASE_URL || 'https://api.vibi.pro').replace(/\/$/, '');
const KEY = process.env.VIBI_API_KEY || '';
const LANG = opt('lang', 'ko').toLowerCase(); // ko | vi | en ...
const GENDER = opt('gender', 'female').toLowerCase();
const LIMIT = Math.max(5, Math.min(100, Number(opt('limit', 25))));
const ONLY = opt('provider', 'all').toLowerCase();
const OUT_HTML = path.resolve(opt('html', path.join(__dirname, '..', 'data', 'vibi-voices.html')));

// Tên ngôn ngữ cho MiniMax (MiniMax dùng tên đầy đủ, không dùng mã ISO)
const MINIMAX_LANG = { ko: 'Korean', vi: 'Vietnamese', en: 'English', ja: 'Japanese', zh: 'Chinese (Mandarin)' };
// CapCut chỉ có: en, vi, zh, id, es, pt, ja, th (KHÔNG có tiếng Hàn)
const CAPCUT_LANGS = ['en', 'vi', 'zh', 'id', 'es', 'pt', 'ja', 'th'];

if (!KEY) {
  console.error('❌ Thiếu VIBI_API_KEY. Lấy khoá ở vibi.pro → Tài liệu API (API Docs) → API Key.');
  process.exit(1);
}

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }
  if (res.status === 401 || res.status === 403) {
    const err = new Error('Khoá API sai hoặc đã bị tạo lại. Lấy khoá mới ở vibi.pro → Tài liệu API.');
    err.fatal = true;
    throw err;
  }
  if (res.status === 402) {
    const err = new Error('Tài khoản Vibi hết tín dụng (credit). Nạp thêm ở vibi.pro → Pricing.');
    err.fatal = true;
    throw err;
  }
  if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status} ${pathname}: ${text.slice(0, 200)}`);
  return data;
}

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

// ---------------------------------------------------------------------------
// 1. Gom giọng từ 3 nhà cung cấp
// ---------------------------------------------------------------------------
async function elevenlabs() {
  const data = await api(
    `/v1/shared-voices?${qs({ page_size: LIMIT, gender: GENDER, required_languages: LANG, sort: 'cloned_by_count' })}`
  );
  return (data.voices || []).map((v) => {
    const lv = (v.verified_languages || []).find((l) => l.language_id === LANG) || {};
    return {
      provider: 'elevenlabs',
      voice_id: v.voice_id,
      name: v.name,
      info: [v.age, v.accent || lv.accent, v.use_case, v.descriptive].filter(Boolean).join(' · '),
      description: v.description || '',
      popularity: v.cloned_by_count || 0,
      usage1y: v.usage_character_count_1y || 0,
      preview: lv.preview_url || v.preview_url || '',
      language: LANG,
      model: lv.model_id || 'eleven_multilingual_v2'
    };
  });
}

async function minimax() {
  const language = MINIMAX_LANG[LANG];
  if (!language) return [];
  const g = GENDER.charAt(0).toUpperCase() + GENDER.slice(1);
  const data = await api(`/v1/minimax/system-voices?${qs({ page_size: LIMIT, language, gender: g })}`);
  return (data.voice_list || []).map((v) => ({
    provider: 'minimax',
    voice_id: v.uniq_id || v.voice_id,
    name: v.voice_name,
    info: (v.tag_list || []).join(' · '),
    description: v.description || '',
    popularity: 0,
    usage1y: 0,
    preview: v.sample_audio || '',
    language,
    model: 'speech-2.8-turbo'
  }));
}

async function capcut() {
  if (!CAPCUT_LANGS.includes(LANG)) return [];
  const g = GENDER.charAt(0).toUpperCase() + GENDER.slice(1);
  const data = await api(`/v1/capcut/system-voices?${qs({ page_size: LIMIT, language: LANG, gender: g })}`);
  return (data.voice_list || []).map((v) => ({
    provider: 'capcut',
    voice_id: v.voice_id,
    name: v.name,
    info: (v.tags || []).join(' · '),
    description: '',
    popularity: 0,
    usage1y: 0,
    preview: (v.preview_url || '').replace('{{BASE_URL}}', BASE),
    language: LANG,
    model: 'capcut'
  }));
}

// ---------------------------------------------------------------------------
// 2. Tạo thử 1 câu bằng giọng đã chọn (--say)
// ---------------------------------------------------------------------------
async function say(text, voiceId, provider) {
  const language = provider === 'minimax' ? MINIMAX_LANG[LANG] || LANG : LANG;
  const body = { text, provider, language_code: language, voice_settings: { speed: 1.0 } };
  if (provider === 'elevenlabs') Object.assign(body, { model_id: 'eleven_multilingual_v2' });
  if (provider === 'minimax') Object.assign(body, { model_id: 'speech-2.8-turbo' });
  const task = await api(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, { method: 'POST', body });
  process.stdout.write(`⏳ Tác vụ ${task.id}`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const t = await api(`/v1/history/${task.id}`);
    process.stdout.write('.');
    if (t.status === 'completed') {
      const url = (t.result && t.result.audio_url) || t.audio_url;
      const res = await fetch(url.startsWith('/') ? BASE + url : url, { headers: { 'xi-api-key': KEY } });
      const out = path.join(__dirname, '..', 'data', `vibi-sample-${provider}-${voiceId}.mp3`.replace(/[^\w.-]/g, '_'));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      console.log(`\n✅ Đã lưu: ${out}  (tốn ${t.credits_deducted ?? '?'} credit)`);
      return;
    }
    if (t.status === 'failed') throw new Error(`Vibi báo lỗi: ${t.error}`);
  }
  throw new Error('Quá thời gian chờ');
}

// ---------------------------------------------------------------------------
// 3. Trang HTML nghe thử
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function writeHtml(list) {
  const rows = list
    .map(
      (v, i) => `<tr>
  <td>${i + 1}</td><td><b>${esc(v.name)}</b><div class="d">${esc(v.description)}</div></td>
  <td><span class="p ${v.provider}">${v.provider}</span></td><td>${esc(v.info)}</td>
  <td>${v.popularity ? v.popularity.toLocaleString() : ''}</td>
  <td>${v.preview ? `<audio controls preload="none" src="${esc(v.preview)}"></audio>` : '—'}</td>
  <td><code>TTS_ENGINE: 'vibi', VIBI_PROVIDER: '${v.provider}', VIBI_VOICE_ID: '${esc(v.voice_id)}', VIBI_LANGUAGE: '${esc(v.language)}'</code></td>
</tr>`
    )
    .join('\n');
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>Giọng Vibi — ${LANG} ${GENDER}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#faf8f3;color:#222}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #ddd;padding:8px;vertical-align:top;font-size:14px}th{text-align:left;background:#efe9dc}
.d{color:#666;font-size:12px;max-width:360px}code{font-size:11px;user-select:all;background:#f1eee6;padding:2px 4px;display:block}
.p{padding:2px 8px;border-radius:99px;color:#fff;font-size:12px}.elevenlabs{background:#222}.minimax{background:#d2452f}.capcut{background:#2a7de1}</style></head>
<body><h2>Giọng ${GENDER === 'female' ? 'nữ' : GENDER} — ngôn ngữ "${LANG}" trên Vibi (${list.length} giọng)</h2>
<p>Bấm ▶ để nghe. Chọn được giọng thì sao chép dòng cấu hình ở cột cuối vào <code style="display:inline">ecosystem.config.cjs</code>.
ElevenLabs xếp theo số lượt được dùng lại (càng cao càng được ưa chuộng).</p>
<table><tr><th>#</th><th>Tên</th><th>Nguồn</th><th>Đặc điểm</th><th>Lượt dùng lại</th><th>Nghe thử</th><th>Cấu hình</th></tr>
${rows}</table></body></html>`;
  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, html);
}

(async () => {
  const sayText = opt('say', '');
  if (sayText) {
    const voice = opt('voice', process.env.VIBI_VOICE_ID || '');
    if (!voice) throw new Error('Thiếu --voice <voice_id>');
    await say(sayText, voice, opt('provider', process.env.VIBI_PROVIDER || 'elevenlabs'));
    return;
  }
  const sources = { elevenlabs, minimax, capcut };
  const all = [];
  for (const [name, fn] of Object.entries(sources)) {
    if (ONLY !== 'all' && ONLY !== name) continue;
    try {
      const list = await fn();
      console.log(`• ${name}: ${list.length} giọng`);
      all.push(...list);
    } catch (err) {
      if (err.fatal) throw err;
      console.warn(`• ${name}: lỗi — ${err.message}`);
    }
  }
  all.sort((a, b) => b.popularity - a.popularity || b.usage1y - a.usage1y);
  console.log('');
  console.table(
    all.slice(0, 40).map((v) => ({
      nguon: v.provider,
      ten: v.name.slice(0, 22),
      voice_id: v.voice_id,
      dac_diem: v.info.slice(0, 40),
      luot_dung: v.popularity || ''
    }))
  );
  writeHtml(all);
  console.log(`\n🎧 Mở trang nghe thử: ${OUT_HTML}`);
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
