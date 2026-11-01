// Bộ nạp "gói phòng": mỗi gói = 1 loại phòng (chùa / nhà thờ) + 1 ngôn ngữ (vi / ko).
// Chọn bằng biến môi trường:  ROOM=temple|church   LOCALE=vi|ko   (hoặc PACK=church.ko)
'use strict';

const PACKS = {
  'temple.vi': require('./temple.vi'),
  'temple.ko': require('./temple.ko'),
  'church.ko': require('./church.ko')
};

const REQUIRED_SPEECH = ['incense', 'bell', 'prayer', 'gift', 'draw'];

function validatePack(pack) {
  const problems = [];
  for (const k of REQUIRED_SPEECH) {
    if (typeof pack.speech?.[k] !== 'function') problems.push(`speech.${k}`);
  }
  if (!Array.isArray(pack.deck) || pack.deck.length === 0) problems.push('deck');
  for (const k of ['fortune', 'bell', 'woodenFish', 'incense', 'prayer']) {
    if (!Array.isArray(pack.keywords?.[k])) problems.push(`keywords.${k}`);
  }
  for (const item of pack.schedule || []) {
    if (!/^\d{2}:\d{2}$/.test(item.time || '')) problems.push(`schedule.time "${item.time}"`);
  }
  if (problems.length) {
    throw new Error(`Gói phòng "${pack.id}" thiếu/sai: ${problems.join(', ')}`);
  }
  return pack;
}

function loadPack({ pack, room, locale } = {}) {
  let id = String(pack || '').trim().toLowerCase();
  if (!id) {
    const r = String(room || 'temple').trim().toLowerCase();
    const l = String(locale || (r === 'church' ? 'ko' : 'vi')).trim().toLowerCase();
    id = `${r}.${l}`;
  }
  if (!PACKS[id]) {
    throw new Error(`Không có gói phòng "${id}". Các gói hiện có: ${Object.keys(PACKS).join(', ')}`);
  }
  return validatePack(PACKS[id]);
}

// Phần gửi xuống trình duyệt (không gửi hàm / danh sách từ khoá)
function clientPack(pack) {
  return {
    id: pack.id,
    room: pack.room,
    locale: pack.locale,
    meta: pack.meta,
    tts: { voice: pack.tts.voice, browserLang: pack.tts.browserLang },
    defaultName: pack.defaultName,
    schedule: (pack.schedule || []).map(({ time, days, title }) => ({ time, days, title })),
    ui: pack.ui || {}
  };
}

module.exports = { PACKS, loadPack, clientPack, validatePack };
