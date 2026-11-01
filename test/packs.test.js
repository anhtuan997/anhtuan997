// Kiểm thử tự động: chạy bằng  npm test  (dùng bộ kiểm thử có sẵn của Node, không cần cài thêm)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PACKS, loadPack, clientPack } = require('../lib/packs');
const { josa, speakableName } = require('../lib/packs/korean');
const { zonedNowIn, isScheduleDue } = require('../lib/zoned-time');

test('mọi gói phòng đều hợp lệ và đủ câu đọc', () => {
  for (const id of Object.keys(PACKS)) {
    const pack = loadPack({ pack: id });
    const card = pack.deck[0];
    for (const k of ['incense', 'bell', 'prayer', 'gift', 'draw']) {
      const line = pack.speech[k]({ name: 'A', count: 3, wish: 'W', gift: '장미', merit: 10, card });
      assert.ok(typeof line === 'string' && line.length > 5, `${id}.speech.${k}`);
    }
    for (const c of pack.deck) {
      for (const f of ['number', 'rank', 'title', 'poem', 'meaning', 'ttsSummary']) {
        assert.ok(c[f] !== undefined && c[f] !== '', `${id} deck thiếu ${f}`);
      }
    }
    const cp = clientPack(pack);
    assert.equal(cp.id, id);
    assert.equal(JSON.parse(JSON.stringify(cp)).id, id, 'clientPack phải chuyển được sang JSON');
  }
});

test('chọn gói theo ROOM/LOCALE', () => {
  assert.equal(loadPack({}).id, 'temple.vi');
  assert.equal(loadPack({ room: 'church' }).id, 'church.ko');
  assert.equal(loadPack({ room: 'temple', locale: 'ko' }).id, 'temple.ko');
  assert.throws(() => loadPack({ pack: 'mosque.xx' }), /Không có gói phòng/);
});

test('trợ từ tiếng Hàn theo phụ âm cuối', () => {
  assert.equal(josa('장미', '을', '를'), '장미를');
  assert.equal(josa('연꽃', '을', '를'), '연꽃을');
  assert.equal(josa('황금 연꽃 공양', '을', '를'), '황금 연꽃 공양을');
  assert.equal(josa('감사의 꽃다발', '으로', '로'), '감사의 꽃다발로');
  assert.equal(josa('Rose', '을', '를'), 'Rose를');
});

test('tên đọc lên bỏ gạch dưới và số đuôi', () => {
  assert.equal(speakableName('minji_kim99'), 'minji kim');
  assert.equal(speakableName('김민지'), '김민지');
});

test('giờ Seoul đúng bất kể múi giờ máy chủ', () => {
  // 2026-11-01 19:00 UTC = 2026-11-02 04:00 KST (thứ Hai)
  const now = zonedNowIn('Asia/Seoul', new Date('2026-11-01T19:00:00Z'));
  assert.deepEqual(now, { date: '2026-11-02', time: '04:00', weekday: 1 });
  // 2026-11-01 02:00 UTC = 11:00 KST Chủ nhật
  const sun = zonedNowIn('Asia/Seoul', new Date('2026-11-01T02:00:00Z'));
  assert.equal(sun.weekday, 0);
  assert.equal(sun.time, '11:00');
});

test('lịch lễ: đúng giờ và đúng ngày trong tuần', () => {
  const church = loadPack({ pack: 'church.ko' });
  const sundayService = church.schedule.find((s) => Array.isArray(s.days));
  assert.ok(isScheduleDue(sundayService, { time: '11:00', weekday: 0 }));
  assert.ok(!isScheduleDue(sundayService, { time: '11:00', weekday: 3 }));
  const dawn = loadPack({ pack: 'temple.ko' }).schedule[0];
  assert.ok(isScheduleDue(dawn, { time: '04:00', weekday: 5 }));
  assert.ok(!isScheduleDue(dawn, { time: '04:01', weekday: 5 }));
});
