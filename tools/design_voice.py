#!/usr/bin/env python3
"""
Thiết kế 1 GIỌNG RIÊNG của dự án bằng Qwen3-TTS VoiceDesign (tạo giọng từ mô tả bằng chữ),
rồi lưu làm giọng mẫu để worker local nhân bản cho mọi câu đọc => giọng luôn ổn định, không phụ thuộc ai.

  .venv/bin/python tools/design_voice.py                       # tạo 3 phương án: voice-ref/candidates/
  .venv/bin/python tools/design_voice.py --pick 2              # chọn phương án 2 làm giọng chính
  .venv/bin/python tools/design_voice.py --instruct "..." --n 4

Giọng do mô hình TẠO RA (không sao chép giọng người thật) => không vướng quyền giọng nói của ai.
"""
import argparse
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "voice-ref"
CAND = OUT / "candidates"

# Mô tả giọng: nữ trung niên, ấm, điềm tĩnh, chậm rãi — hợp không khí cầu nguyện
DEFAULT_INSTRUCT = (
    "A warm, calm, middle-aged Korean woman in her forties with a soft, gentle and soothing voice. "
    "She speaks slowly and clearly in standard Seoul Korean, like a caring prayer leader in a quiet church: "
    "peaceful, reverent, comforting and sincere, with natural breathing and no exaggeration."
)
# Câu mẫu ~10 giây: đủ âm tiết để nhân bản tốt, giọng điệu giống nội dung sẽ đọc trên live
REF_TEXT = (
    "안녕하세요. 이곳은 언제나 열려 있는 기도의 집입니다. "
    "오늘 하루도 평안하시기를 바라며, 여러분의 기도 제목을 함께 나누겠습니다."
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--instruct", default=DEFAULT_INSTRUCT)
    ap.add_argument("--n", type=int, default=3, help="số phương án giọng để chọn")
    ap.add_argument("--pick", type=int, help="chọn phương án số mấy làm giọng chính")
    ap.add_argument("--model", default="Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
    ap.add_argument("--device", default=os.environ.get("QWEN_TTS_DEVICE", "auto"))
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    if args.pick:
        src = CAND / f"voice_{args.pick}.wav"
        if not src.is_file():
            sys.exit(f"Không có {src}. Chạy tạo phương án trước.")
        shutil.copyfile(src, OUT / "ko_voice.wav")
        (OUT / "ko_voice.txt").write_text(REF_TEXT + "\n", "utf-8")
        print(f"✅ Đã chọn phương án {args.pick} làm giọng chính: voice-ref/ko_voice.wav")
        return

    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
    dtype = torch.bfloat16 if device in ("cuda", "mps") else torch.float32
    print(f"Đang nạp {args.model} trên {device}...")
    model = Qwen3TTSModel.from_pretrained(args.model, device_map=device, dtype=dtype)
    CAND.mkdir(parents=True, exist_ok=True)
    for i in range(1, args.n + 1):
        torch.manual_seed(1000 + i)  # mỗi phương án 1 hạt giống => giọng khác nhau, tạo lại được y hệt
        wavs, sr = model.generate_voice_design(text=REF_TEXT, language="Korean", instruct=args.instruct)
        wav = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
        peak = float(np.max(np.abs(wav))) or 1.0
        wav = wav * min(1.0, 0.95 / peak)
        path = CAND / f"voice_{i}.wav"
        sf.write(str(path), wav, sr, subtype="PCM_16")
        print(f"  • Phương án {i}: {path.relative_to(ROOT)} ({len(wav) / sr:.1f}s)")
    (CAND / "ref_text.txt").write_text(REF_TEXT + "\n", "utf-8")
    (CAND / "instruct.txt").write_text(args.instruct + "\n", "utf-8")
    print("Nghe thử rồi chọn: python tools/design_voice.py --pick <số>")


if __name__ == "__main__":
    main()
