#!/usr/bin/env python3
"""
Sinh tài nguyên cho chế độ "3D chân thực" (Realistic 3D / 2.5D Parallax).

Chạy:  python3 tools/build_3d_assets.py
Yêu cầu: Pillow + numpy (uv pip install pillow numpy)

Đầu vào  : public/assets/amitabha_stage.png  (ảnh nền Chánh Điện 941x1672)
           public/assets/devotee*.png         (8 khung hình Phật tử áo lam)
Đầu ra   : public/assets/3d/
  - amitabha_depth.png : Bản đồ chiều sâu (depth map, 0 = xa, 255 = gần).
                         Giá trị là "độ lệch thị sai" (disparity ~ 1/khoảng cách),
                         nên sàn nhà phẳng tăng TUYẾN TÍNH theo trục dọc — đúng vật lý
                         của phép chiếu phối cảnh.
  - amitabha_glow.jpg  : Lớp phát sáng (bloom) — chỉ giữ vùng sáng rồi làm nhòe.
  - amitabha_rays.jpg  : Tia sáng thể tích (god rays) tỏa ra từ hào quang Đức Phật.
  - devotee*.png       : Nhân vật đã chỉnh màu ấm theo ánh sáng Chánh Điện,
                         tăng viền sáng ngược (rim light), bỏ bóng đen dính sẵn,
                         làm mềm mép cắt.

Mọi hằng số hình học khai báo bên dưới được dùng chung với public/js/depth3d.js
(FLOOR_HORIZON_Y, FOCUS_DEPTH...). Sửa một bên thì phải sửa cả bên kia.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
OUT = ASSETS / "3d"

# --------------------------------------------------------------------------
# Hình học cảnh (toạ độ ảnh gốc 941 x 1672)
# --------------------------------------------------------------------------
SRC_W, SRC_H = 941, 1672
# Đường chân trời của sàn: tính từ độ hội tụ của 2 mép thảm đỏ.
#   Mép thảm ở y=1095 rộng ~255px, ở y=1672 rộng ~880px
#   => (1672 - yh) / (1095 - yh) = 880/255  =>  yh ≈ 860
FLOOR_HORIZON_Y = 860.0
FLOOR_START_Y = 1095.0  # mép trước của bục gỗ / bắt đầu sàn đá bóng


def floor_disparity(y):
    return (y - FLOOR_HORIZON_Y) / (SRC_H - FLOOR_HORIZON_Y)


def ellipse_mask(xx, yy, cx, cy, rx, ry):
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0


def build_depth():
    yy, xx = np.mgrid[0:SRC_H, 0:SRC_W].astype(np.float32)
    d = np.full((SRC_H, SRC_W), 0.04, np.float32)  # tường hậu điện, xa nhất

    def paint(mask, value):
        np.maximum(d, np.where(mask, value, 0.0), out=d)

    # Vách gỗ chạm khắc hai bên + hào quang (mandorla) sau lưng tượng
    paint(ellipse_mask(xx, yy, 470, 300, 250, 300), 0.07)
    # Thân tượng Đức Phật & đầu (nhô ra trước hào quang)
    paint(ellipse_mask(xx, yy, 470, 420, 205, 190), 0.12)
    paint(ellipse_mask(xx, yy, 470, 215, 72, 95), 0.13)
    paint(ellipse_mask(xx, yy, 470, 470, 110, 60), 0.14)  # tay & đài sen nhỏ
    # Đài sen lớn dưới tượng
    paint(ellipse_mask(xx, yy, 470, 660, 285, 95), 0.17)
    # Hai bình sen lớn hai bên
    paint(ellipse_mask(xx, yy, 150, 580, 125, 150), 0.19)
    paint(ellipse_mask(xx, yy, 790, 580, 125, 150), 0.19)
    # Bàn thờ: tầng sau (rồng, lư hương), tầng trước (mặt bàn chạm)
    paint((yy > 735) & (yy < 895) & (xx > 85) & (xx < 860), 0.21)
    paint((yy > 880) & (yy < 1000) & (xx > 70) & (xx < 875), 0.23)
    # Cột trụ hai bên (gần hơn vách)
    pillar = ((xx < 92) | (xx > 850)) & (yy < 1045)
    paint(pillar, 0.22)
    # Đèn lồng treo hai góc trên — nằm gần ống kính hơn
    paint(ellipse_mask(xx, yy, 40, 140, 70, 120), 0.28)
    paint(ellipse_mask(xx, yy, 900, 140, 70, 120), 0.28)
    # Hàng đệm quỳ VIP + bục gỗ
    paint((yy > 980) & (yy < 1055) & (xx > 55) & (xx < 885), 0.26)
    paint((yy >= 1040) & (yy < FLOOR_START_Y), 0.27)
    # Sàn đá bóng + thảm đỏ (tuyến tính theo y — đúng phối cảnh mặt phẳng)
    floor = yy >= FLOOR_START_Y
    d = np.where(floor, np.maximum(d, floor_disparity(yy)), d)

    img = Image.fromarray(np.clip(d * 255.0, 0, 255).astype(np.uint8), "L")
    # Làm mượt biên để khi dịch thị sai không bị xé ảnh (tearing)
    img = img.filter(ImageFilter.GaussianBlur(7))
    img.save(OUT / "amitabha_depth.png", optimize=True)
    return np.asarray(img, np.float32) / 255.0


def build_glow(src):
    arr = np.asarray(src.convert("RGB"), np.float32) / 255.0
    lum = arr @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    # Giữ vùng rất sáng (đèn lồng, hào quang, nến) — ngưỡng mềm
    w = np.clip((lum - 0.62) / 0.3, 0, 1) ** 1.6
    hi = arr * w[..., None]
    hi_img = Image.fromarray((hi * 255).astype(np.uint8), "RGB")
    # Bloom nhiều tầng: cộng các mức nhòe khác nhau cho quầng sáng tự nhiên
    acc = np.zeros_like(arr)
    for radius, weight in ((4, 0.45), (12, 0.35), (32, 0.35)):
        acc += np.asarray(hi_img.filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255.0 * weight
    out = Image.fromarray(np.clip(acc * 255, 0, 255).astype(np.uint8), "RGB")
    out = out.resize((SRC_W // 2, SRC_H // 2), Image.LANCZOS)  # lớp mờ nên nửa độ phân giải là đủ
    out.save(OUT / "amitabha_glow.jpg", quality=90)
    return hi


def build_rays(hi):
    """Radial (zoom) blur từ tâm hào quang => tia sáng thể tích."""
    cx, cy = 470.0, 300.0
    h, w = hi.shape[:2]
    small = 2  # tính ở nửa độ phân giải cho nhanh
    base = Image.fromarray((hi * 255).astype(np.uint8), "RGB").resize((w // small, h // small), Image.BILINEAR)
    b = np.asarray(base, np.float32) / 255.0
    hh, ww = b.shape[:2]
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
    scx, scy = cx / small, cy / small
    acc = np.zeros_like(b)
    samples = 48
    decay = 1.0
    total = 0.0
    for i in range(samples):
        t = i / samples * 0.85
        sx = np.clip(xx + (scx - xx) * t, 0, ww - 1).astype(np.int32)
        sy = np.clip(yy + (scy - yy) * t, 0, hh - 1).astype(np.int32)
        acc += b[sy, sx] * decay
        total += decay
        decay *= 0.965
    acc /= total
    # Tia sáng chỉ nên rơi trong không gian (yếu dần về phía người xem)
    fade = np.clip(1.15 - yy / hh, 0.15, 1.0) ** 1.2
    acc *= fade[..., None] * 2.2
    out = Image.fromarray(np.clip(acc * 255, 0, 255).astype(np.uint8), "RGB")
    out = out.filter(ImageFilter.GaussianBlur(3))
    out.save(OUT / "amitabha_rays.jpg", quality=88)


# --------------------------------------------------------------------------
# Nhân vật Phật tử áo lam — hoà màu vào ánh sáng Chánh Điện
# --------------------------------------------------------------------------
SPRITES = [
    "devotee", "devotee_walk", "devotee_walk_2", "devotee_kneel_down",
    "devotee_bow", "devotee_bow_mid", "devotee_prostrate", "devotee_prostrate_deep",
]


def erode_distance(alpha_mask, steps):
    """Khoảng cách (pixel) từ mỗi điểm bên trong tới mép, tối đa `steps`."""
    dist = np.zeros(alpha_mask.shape, np.float32)
    cur = alpha_mask.copy()
    for i in range(1, steps + 1):
        nb = cur.copy()
        nb[1:, :] &= cur[:-1, :]
        nb[:-1, :] &= cur[1:, :]
        nb[:, 1:] &= cur[:, :-1]
        nb[:, :-1] &= cur[:, 1:]
        dist[cur & ~nb] = i
        cur = nb
    dist[cur] = steps + 1
    return dist


def enhance_sprite(name):
    im = Image.open(ASSETS / f"{name}.png").convert("RGBA")
    a = np.asarray(im, np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3]

    # 1) Bỏ bóng đen nướng sẵn (baked drop-shadow): pixel bán trong suốt & tối
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    shadow = (alpha < 0.82) & (lum < 0.12)
    alpha = np.where(shadow, 0.0, alpha)
    body = alpha > 0.5

    # 2) Làm mềm mép cắt 1px (anti-alias) để không còn viền "dán giấy"
    soft = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.7))
    alpha = np.minimum(alpha, np.asarray(soft, np.float32) / 255.0 * 1.15)
    alpha = np.clip(alpha, 0, 1)

    # 3) Chỉnh màu: người quay lưng về ống kính, nguồn sáng mạnh (bàn thờ) ở PHÍA TRƯỚC họ
    #    => mặt lưng nhận ánh sáng môi trường ấm & tối hơn, mép viền sáng vàng (backlight).
    # Giữ sắc áo LAM đặc trưng nhưng hạ độ sáng & ngả ấm nhẹ theo đèn nến; tăng tương phản
    # để nếp vải có khối (volume) rõ hơn thay vì phẳng như hình dán.
    warm_ambient = np.array([0.99, 0.89, 0.80], np.float32)
    graded = rgb * warm_ambient * 0.88
    graded = (graded - 0.5) * 1.16 + 0.5 - 0.08

    # 4) Ambient occlusion: tối dần về phía chân (gần sàn) và vùng trong lõi
    h = rgb.shape[0]
    ys = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    ao = 1.0 - 0.22 * np.clip((ys - 0.72) / 0.28, 0, 1) ** 1.5
    graded *= ao[..., None]

    # 5) Rim light ấm theo mép trên/hai bên (ánh nến & hào quang từ phía trước)
    dist = erode_distance(body, 5)
    rim = np.exp(-(dist - 1).clip(0) / 1.6) * body
    # mạnh hơn ở nửa trên thân (vai, đầu) — nơi ánh sáng từ cao chiếu tới
    rim *= np.clip(1.25 - 1.3 * ys, 0.0, 1.0)
    rim_color = np.array([1.0, 0.78, 0.42], np.float32)
    graded = graded + rim[..., None] * rim_color * 0.26

    out = np.dstack([np.clip(graded, 0, 1), alpha])
    # 6) Cắt các hàng trống dưới chân (chỗ bóng đen cũ) => chân chạm đúng đáy ảnh,
    #    bóng đổ & phản chiếu CSS bám sát mặt sàn. (CSS dùng object-position: bottom)
    rows = np.where((alpha > 0.05).any(axis=1))[0]
    bottom = int(rows.max()) + 2 if rows.size else out.shape[0]
    out = out[: min(bottom, out.shape[0])]
    Image.fromarray((out * 255).round().astype(np.uint8), "RGBA").save(OUT / f"{name}.png", optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    src = Image.open(ASSETS / "amitabha_stage.png").convert("RGB")
    assert src.size == (SRC_W, SRC_H), f"Ảnh nền phải là {SRC_W}x{SRC_H}, nhận {src.size}"
    build_depth()
    hi = build_glow(src)
    build_rays(hi)
    for s in SPRITES:
        enhance_sprite(s)
    print("Đã sinh tài nguyên 3D vào", OUT)


if __name__ == "__main__":
    main()
