# 🖥️ Hướng dẫn chạy trên máy cục bộ (MacBook M1/M2/M3)

> Thuật ngữ: *TTS* = máy đọc chữ thành giọng; *OBS* = phần mềm phát trực tiếp; *pm2* = công cụ giữ chương trình chạy 24/7; *Terminal* = ứng dụng gõ lệnh của macOS (Launchpad → Terminal).

Phòng đang tập trung: **Nhà thờ tiếng Hàn "24시 기도의 집"** (cảnh 3D thật), cổng **3002**.

---

## 1. Trong gói này có gì

| Thư mục / file | Nội dung |
| :--- | :--- |
| `server.js` | Máy chủ: đọc bình luận/quà TikTok, điều khiển phòng, gọi giọng đọc |
| `public/` | Màn hình live (`church.html` = Nhà thờ 3D, `index.html` = Chùa) |
| `lib/packs/` | Câu chữ từng phòng: `church.ko.js` (Nhà thờ Hàn), `temple.ko.js` (Chùa Hàn), `temple.vi.js` (Chùa Việt) |
| `tts_worker_local.py` | Giọng đọc **chạy trên máy** (Qwen3-TTS, miễn phí, không cần mạng) |
| `tts_worker_vibi.py` | Giọng đọc qua **Vibi** (trả phí) |
| `tts_worker_edge.py` | Giọng Microsoft miễn phí (cần mạng, dùng làm dự phòng) |
| `voice-ref/ko_voice.wav` | **Giọng nữ riêng của dự án** (đang dùng) + 2 phương án khác trong `candidates/` |
| `voice-prerecorded/` | 49 câu cố định đã thu sẵn bằng giọng Sunny (Vibi) |
| `docs/voice-samples/` | File nghe thử: 6 giọng Vibi, giọng chạy trên máy |
| `docs/demo/` | Ảnh chụp các phòng |
| `docs/KOREA-24-7.md` | Hướng dẫn đầy đủ (số liệu, quy định TikTok Hàn, bản quyền, OBS…) |
| `ecosystem.config.cjs` | Cấu hình chạy 24/7 bằng pm2 |
| `tools/` | Công cụ: tìm giọng Vibi, thiết kế giọng, thu sẵn câu cố định |

**Không có trong gói** (tự tải khi cài): thư viện Node (`node_modules`, ~60MB), thư viện Python (`.venv`), mô hình giọng Qwen3-TTS (~2,5GB, tự tải lần đầu chạy).

**Không có khoá bí mật nào** trong gói. Khoá Vibi bạn tự đặt (xem mục 4).

---

## 2. Cài đặt (làm 1 lần)

Mở **Terminal**, dán từng dòng:

```bash
# 2.1 Cài công cụ nền (Homebrew = trình cài phần mềm cho Mac)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node python@3.12 ffmpeg
brew install --cask obs

# 2.2 Giải nén gói vào thư mục home rồi vào thư mục đó
cd ~/tiktok-live-church        # tên thư mục sau khi giải nén

# 2.3 Thư viện
npm install
npm run setup:tts-local        # cài Qwen3-TTS + edge-tts vào .venv (mất vài phút)
npm i -g pm2

# 2.4 Kiểm tra
npm test                       # phải thấy: pass 6, fail 0
```

---

## 3. Điền tài khoản TikTok

Mở `ecosystem.config.cjs` bằng TextEdit / VS Code, sửa:
```js
TIKTOK_USER: 'tai_khoan_nha_tho_han',   // ← tên TikTok của bạn, KHÔNG có @
```

---

## 4. Chọn giọng đọc

| Cách | Lệnh trước khi chạy | Chi phí |
| :--- | :--- | :--- |
| ⭐ **Chạy trên máy** (giọng riêng) | `export TTS_ENGINE=local` | Miễn phí |
| Vibi – giọng Sunny | `export TTS_ENGINE=vibi VIBI_API_KEY=khoá_mới` | Trả theo ký tự |
| Microsoft miễn phí | `export TTS_ENGINE=edge` | Miễn phí, cần mạng |

⚠️ Khoá Vibi cũ đã lộ trong cuộc trò chuyện ⇒ vào vibi.pro → Tài liệu API → **Tạo lại** (*Regenerate*), dùng khoá mới.

Muốn đặt cố định: thêm dòng `export TTS_ENGINE=local` vào cuối file `~/.zshrc`, rồi `source ~/.zshrc`.

---

## 5. Chạy thử

```bash
export TTS_ENGINE=local
npm run start:local
```
- Lần đầu tự tải mô hình ~2,5GB. Chờ dòng **`[Qwen3-TTS] Sẵn sàng trên mps`** (mps = đang dùng GPU của Mac).
- Mở Chrome: **http://localhost:3002** → bên phải là bảng điều khiển tiếng Việt, bấm thử các nút.
- Trong Terminal, dòng `synthSec` = số giây tạo 1 câu. **Dưới ~5 giây là dùng tốt cho live.**
- Thu sẵn câu cố định (1 lần): mở Terminal thứ hai, `cd` vào thư mục, chạy `npm run pregen`.
- Dừng: bấm `Ctrl + C`.

---

## 6. Cài OBS

1. **Settings → Video**: Base và Output đều `1080x1920`, FPS `30`.
2. **Settings → Output**: Encoder **Apple VT H264 Hardware Encoder**, Bitrate `4500–6000 Kbps`, Keyframe `2s`.
3. **Sources → + → Browser**:
   - URL `http://localhost:3002/?obs=1`, rộng `1080`, cao `1920`.
   - ✅ chọn **Control audio via OBS** (bắt buộc, nếu không giọng đọc không lên live).
   - ❌ bỏ chọn **Shutdown source when not visible**.
4. **Settings → Advanced**: bật **Automatically Reconnect**.

---

## 7. Kết nối TikTok

Có **2 đường riêng**:
```
① HÌNH + TIẾNG lên TikTok:   trang phòng → OBS → TikTok (bằng khoá phát)
② BÌNH LUẬN/QUÀ về phòng:    phòng live TikTok → máy chủ đọc theo @tên (chỉ đọc, không cần mật khẩu)
```

1. Lấy **khoá phát** (Server URL + Stream Key) trong TikTok: **LIVE Center / Phát bằng PC**. Tài khoản phải đủ điều kiện (thường ≥ 18 tuổi, ~1.000 người theo dõi; ở Hàn nhận quà cần ≥ 19 tuổi — TikTok quyết định).
2. OBS → **Settings → Stream → Service: Custom** → dán Server + Stream Key.
3. Chạy phòng (mục 5 hoặc 8), rồi bấm **Start Streaming** trong OBS.
4. 15 giây – 1 phút sau, góc trái màn hình live hiện **chấm xanh** `LIVE @tên • N명 함께 기도 중` ⇒ đã đọc được bình luận. Nếu chưa, máy chủ tự thử lại (15 giây → 5 phút).
5. Thử bằng điện thoại khác: bình luận `기도합니다` → thẻ cầu nguyện bay lên + giọng đọc.

Kết nối hay báo lỗi khi chạy lâu: tạo khoá ở **eulerstream.com** (máy chủ ký mà thư viện TikTok dùng) rồi `export TIKTOK_SIGN_API_KEY=...`.

---

## 8. Chạy 24/7

```bash
export TTS_ENGINE=local
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup        # chạy tiếp lệnh sudo mà nó in ra
caffeinate -dimsu &            # giữ Mac không ngủ
pm2 logs church-ko             # xem nhật ký;  pm2 restart church-ko --update-env  sau khi đổi biến
```
- Cắm sạc, không gập máy. **System Settings → Battery → Options**: bật *Prevent automatic sleeping when the display is off*.
- Tắt tự cập nhật macOS (**General → Software Update**).
- Kiểm tra sức khoẻ: mở http://localhost:3002/healthz

---

## 9. Bình luận người xem → màn hình

| Người xem viết (tiếng Hàn — nghĩa) | Trên màn hình |
| :--- | :--- |
| `기도` (cầu nguyện), `주님`, `하나님`, `축복`, `감사`, `건강`… | Thẻ ý cầu nguyện bay lên + quả cầu sáng + giọng đọc |
| `촛불` (nến), `봉헌` (dâng) | Thắp nến trên giá 36 ngọn |
| `오늘의 말씀` / `말씀` / `성경` | Thẻ câu Kinh Thánh + giọng đọc |
| `아멘`, `할렐루야` / thả tim | Trái tim bay lên |
| `종소리` (tiếng chuông) | Chuông + thập tự bừng sáng |
| Theo dõi kênh | Giọng cảm ơn tên người theo dõi |
| Quà nhỏ / quà ≥ 100 xu | Cảm ơn + bảng xếp hạng / băng rôn "할렐루야 찬양" |

Tự động theo giờ **Seoul**: 05:00 cầu nguyện sáng, 12:00 trưa, 21:00 tối, Chủ nhật 11:00 thờ phượng. Phòng vắng 5 phút ⇒ tự đọc 1 câu Kinh Thánh.

---

## 10. Gặp lỗi thì làm gì

| Hiện tượng | Cách xử lý |
| :--- | :--- |
| Không có tiếng trên live | OBS: bật *Control audio via OBS*; trong trang bấm 1 lần để cho phép âm thanh |
| `[Qwen3-TTS] Sẵn sàng trên cpu` (không phải mps) | Cài lại: `rm -rf .venv && npm run setup:tts-local` |
| Giọng chạy trên máy quá chậm | Dùng tạm `TTS_ENGINE=edge` hoặc `vibi`; gửi số `synthSec` cho người hỗ trợ |
| Chấm đỏ, không đọc được bình luận | Tài khoản phải **đang live**; kiểm tra `TIKTOK_USER`; xem `pm2 logs church-ko` |
| Cảnh 3D giật | URL OBS thêm `&q=0.75&shadows=0` |

Muốn đổi sang **Chùa tiếng Hàn**: trong `ecosystem.config.cjs` sửa `PACK: 'church.ko'` thành `'temple.ko'` và `PORT` thành 3001.
