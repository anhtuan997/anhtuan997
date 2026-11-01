/**
 * PM2 — giữ phòng live chạy 24/7.
 *   npm i -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup     # tự chạy lại khi bật máy (macOS: chạy lệnh sudo mà nó in ra)
 *   pm2 logs church-ko          # xem nhật ký
 *
 * Hiện TẬP TRUNG 1 PHÒNG: Nhà thờ tiếng Hàn (24시 기도의 집) — cảnh 3D, cổng 3002.
 * Muốn đổi sang Chùa tiếng Hàn: sửa PACK thành 'temple.ko' (mã 2 phòng còn lại vẫn giữ nguyên).
 *
 * GIỌNG ĐỌC — chọn bằng biến môi trường TTS_ENGINE trước khi chạy pm2:
 *  local — Qwen3-TTS chạy NGAY TRÊN MÁY (miễn phí, không cần Internet; hợp Mac M1/M2/M3).
 *          Cài: npm run setup:tts-local. Giọng: voice-ref/ (giọng riêng của dự án) hoặc Sohee có sẵn.
 *  vibi  — cần thêm VIBI_API_KEY (trả phí theo ký tự). KHÔNG ghi khoá vào file này.
 *  edge  — giọng Microsoft miễn phí (cần Internet). Mặc định khi không chọn gì.
 */
const SUNNY = '4p0HBzAAGyju0nYfNntV';

function ttsEnv() {
  const engine = process.env.TTS_ENGINE || (process.env.VIBI_API_KEY ? 'vibi' : 'edge');
  if (engine === 'local') {
    return {
      TTS_ENGINE: 'local',
      QWEN_TTS_MODE: process.env.QWEN_TTS_MODE || 'clone', // clone: giọng trong voice-ref/ | speaker: Sohee
      QWEN_TTS_DEVICE: process.env.QWEN_TTS_DEVICE || 'auto' // auto: mps trên Mac, cuda nếu có, không thì cpu
    };
  }
  if (engine === 'vibi' && process.env.VIBI_API_KEY) {
    return {
      TTS_ENGINE: 'vibi',
      VIBI_API_KEY: process.env.VIBI_API_KEY,
      VIBI_VOICE_ID: process.env.VIBI_VOICE_ID || SUNNY,
      VIBI_PROVIDER: process.env.VIBI_PROVIDER || 'elevenlabs',
      VIBI_LANGUAGE: 'ko',
      VIBI_MODEL: 'eleven_multilingual_v2',
      VIBI_DAILY_CHAR_LIMIT: process.env.VIBI_DAILY_CHAR_LIMIT || 30000
    };
  }
  return { TTS_ENGINE: 'edge' };
}

module.exports = {
  apps: [
    {
      name: 'church-ko',
      script: 'server.js',
      cwd: __dirname,
      autorestart: true,
      exp_backoff_restart_delay: 2000, // lỗi liên tục => chờ lâu dần, tránh vòng lặp crash
      max_memory_restart: '900M', // chỉ tính tiến trình Node; mô hình giọng chạy ở tiến trình Python riêng
      kill_timeout: 8000, // đủ thời gian lưu dữ liệu và tắt mô hình giọng
      time: true,
      env: {
        NODE_ENV: 'production',
        PACK: 'church.ko',
        PORT: 3002,
        TIKTOK_USER: 'tai_khoan_nha_tho_han', // <== SỬA thành tài khoản TikTok của bạn
        IDLE_TALK_MINUTES: 5,
        MAX_DEVOTEES: 5000,
        TTS_CACHE_MAX_AGE_HOURS: 24,
        TTS_CACHE_MAX_FILES: 3000,
        ...ttsEnv()
      }
    }
  ]
};
