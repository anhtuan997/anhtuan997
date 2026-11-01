/**
 * PM2 — trình quản lý tiến trình giữ máy chủ chạy 24/7
 *   npm i -g pm2
 *   pm2 start ecosystem.config.cjs --only church-ko      # chỉ chạy phòng Nhà thờ tiếng Hàn
 *   pm2 start ecosystem.config.cjs --only temple-ko,church-ko
 *   pm2 start ecosystem.config.cjs                       # chạy cả 3 phòng
 *   pm2 save && pm2 startup     # tự chạy lại khi khởi động máy
 *   pm2 logs church-ko          # xem nhật ký
 *
 * MỖI PHÒNG = 1 tài khoản TikTok riêng + 1 cổng riêng + 1 cảnh OBS riêng.
 * Sửa TIKTOK_USER của từng phòng trước khi chạy.
 */
const common = {
  script: 'server.js',
  // Muốn chạy bằng Bun thì bỏ chú thích dòng dưới (Node.js >= 18 cũng chạy tốt)
  // interpreter: 'bun',
  cwd: __dirname,
  autorestart: true,
  // Khởi động lại với độ trễ tăng dần nếu bị lỗi liên tục (tránh vòng lặp crash)
  exp_backoff_restart_delay: 2000,
  // Rò rỉ bộ nhớ sau nhiều ngày => tự khởi động lại khi vượt ngưỡng
  max_memory_restart: '700M',
  kill_timeout: 5000, // đủ thời gian lưu Bảng xếp hạng khi tắt
  time: true
};

const commonEnv = {
  NODE_ENV: 'production',
  MAX_DEVOTEES: 5000,
  TTS_CACHE_MAX_AGE_HOURS: 24,
  TTS_CACHE_MAX_FILES: 3000
};

module.exports = {
  apps: [
    {
      // Chùa tiếng Việt (bản gốc) — giọng ZeroTTS Mai Chi, chạy offline
      ...common,
      name: 'temple-live',
      env: { ...commonEnv, PACK: 'temple.vi', PORT: 3000, TIKTOK_USER: 'zenfacts_vn' }
    },
    {
      // Chùa tiếng Hàn (온라인 법당) — giọng edge-tts ko-KR-SunHiNeural (cần Internet)
      ...common,
      name: 'temple-ko',
      env: {
        ...commonEnv,
        PACK: 'temple.ko',
        PORT: 3001,
        TIKTOK_USER: 'tai_khoan_chua_han', // <== SỬA
        IDLE_TALK_MINUTES: 5 // phòng vắng 5 phút => tự đọc 1 lời Phật dạy (0 = tắt)
      }
    },
    {
      // Nhà thờ tiếng Hàn (24시 기도의 집) — cảnh 3D Three.js, giọng edge-tts
      ...common,
      name: 'church-ko',
      env: {
        ...commonEnv,
        PACK: 'church.ko',
        PORT: 3002,
        TIKTOK_USER: 'tai_khoan_nha_tho_han', // <== SỬA
        IDLE_TALK_MINUTES: 5
        // TTS_VOICE: 'ko-KR-InJoonNeural',    // giọng nam (mặc định: giọng nữ SunHi)
      }
    }
  ]
};
