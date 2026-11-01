/**
 * PM2 — trình quản lý tiến trình giữ máy chủ chạy 24/7
 *   npm i -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup     # tự chạy lại khi khởi động máy
 *   pm2 logs temple-live        # xem nhật ký
 */
module.exports = {
  apps: [
    {
      name: 'temple-live',
      script: 'server.js',
      // Muốn chạy bằng Bun thì bỏ chú thích dòng dưới (Node.js >= 18 cũng chạy tốt)
      // interpreter: 'bun',
      cwd: __dirname,
      autorestart: true,
      // Khởi động lại với độ trễ tăng dần nếu bị lỗi liên tục (tránh vòng lặp crash)
      exp_backoff_restart_delay: 2000,
      // Rò rỉ bộ nhớ sau nhiều ngày => tự khởi động lại khi vượt ngưỡng
      max_memory_restart: '700M',
      kill_timeout: 5000, // đủ thời gian lưu Bảng Vàng Công Đức khi tắt
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TIKTOK_USER: 'zenfacts_vn',
        MAX_DEVOTEES: 5000,
        TTS_CACHE_MAX_AGE_HOURS: 24,
        TTS_CACHE_MAX_FILES: 3000
      }
    }
  ]
};
