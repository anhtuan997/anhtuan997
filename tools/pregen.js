#!/usr/bin/env node
/**
 * "Thu sẵn" mọi câu cố định của phòng đang chạy (lời dạy, câu Kinh Thánh, giờ lễ, lời mời) bằng giọng hiện tại.
 * Chạy 1 lần sau khi chọn giọng Vibi => về sau những câu này phát ngay, không tốn thêm credit.
 *   PORT=3002 node tools/pregen.js        (mặc định cổng 3002 = phòng Nhà thờ)
 */
'use strict';
const port = process.env.PORT || process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 3002;
fetch(`http://127.0.0.1:${port}/rpc`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'room.pregenerate', params: {} })
})
  .then((r) => r.json())
  .then((d) => {
    if (d.error) throw new Error(d.error.message);
    const r = d.result;
    console.log(`Giọng: ${r.engine} • ${r.total} câu cố định: mới tạo ${r.ok} (${r.chars} ký tự), đã có sẵn ${r.cached}, lỗi ${r.failed}`);
    // --save: chép file vào voice-prerecorded/ để commit lên Git, máy khác dùng lại không tốn credit
    if (process.argv.includes('--save')) {
      const fs = require('fs');
      const path = require('path');
      const root = path.join(__dirname, '..');
      const outDir = path.join(root, 'voice-prerecorded');
      fs.mkdirSync(outDir, { recursive: true });
      let n = 0;
      for (const f of r.files || []) {
        if (!/^vibi_/.test(f)) continue; // chỉ giữ giọng trả phí; giọng miễn phí tạo lại được
        const src = path.join(root, 'data', 'tts-cache', f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(outDir, f));
          n++;
        }
      }
      console.log(`💾 Đã lưu ${n} file vào voice-prerecorded/ (nhớ git add + commit)`);
    }
  })
  .catch((e) => {
    console.error('❌ Không gọi được máy chủ ở cổng', port, '—', e.message);
    process.exit(1);
  });
