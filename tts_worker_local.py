#!/usr/bin/env python3
"""
Worker giọng đọc CHẠY TRÊN MÁY bằng Qwen3-TTS (Alibaba Qwen, giấy phép Apache-2.0 — được dùng thương mại).
- Không cần Internet, không tốn phí theo ký tự. Hợp nhất với Mac Apple Silicon (M1/M2/M3, dùng GPU qua MPS).
- Giao thức GIỐNG HỆT các worker khác (stdin/stdout mỗi dòng 1 JSON) => server.js dùng chung (TTS_ENGINE=local).

Hai chế độ (QWEN_TTS_MODE):
  clone   (mặc định) — nhân bản giọng từ voice-ref/ko_voice.wav + ko_voice.txt (lời của file đó).
           File giọng mẫu PHẢI là giọng bạn có quyền dùng: giọng tự thu, người đã đồng ý, hoặc giọng
           do chính Qwen3 VoiceDesign tạo (tools/design_voice.py — dự án đã tạo sẵn 1 giọng như vậy).
  speaker — dùng giọng có sẵn của mô hình, mặc định "Sohee" (nữ, người Hàn).

Biến môi trường:
  QWEN_TTS_MODE     clone | speaker
  QWEN_TTS_MODEL    mặc định: Qwen/Qwen3-TTS-12Hz-0.6B-Base (clone) / Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice (speaker)
                    muốn giọng tự nhiên hơn (chậm hơn): Qwen/Qwen3-TTS-12Hz-1.7B-Base
  QWEN_TTS_DEVICE   auto | mps | cuda | cpu
  QWEN_REF_AUDIO    mặc định voice-ref/ko_voice.wav
  QWEN_REF_TEXT     mặc định nội dung voice-ref/ko_voice.txt
  QWEN_SPEAKER      mặc định Sohee (chế độ speaker)
  QWEN_INSTRUCT     (chế độ speaker) mô tả cách đọc, vd. "차분하고 따뜻하게"
  QWEN_LANGUAGE     mặc định Korean
"""
import hashlib
import json
import os
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from tts_worker_edge import clean_text  # noqa: E402  (dùng chung bộ lọc chữ: giữ Hangul, bỏ emoji/ㅋㅋㅋ)

CACHE_DIR = ROOT / "data" / "tts-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

MODE = os.environ.get("QWEN_TTS_MODE", "clone").strip().lower()
DEFAULT_MODEL = {
    "clone": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",  # đã kiểm chứng; muốn tự nhiên hơn: 1.7B-Base
    "speaker": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
}
MODEL_ID = os.environ.get("QWEN_TTS_MODEL", DEFAULT_MODEL.get(MODE, DEFAULT_MODEL["clone"]))
DEVICE_PREF = os.environ.get("QWEN_TTS_DEVICE", "auto").strip().lower()
REF_AUDIO = os.environ.get("QWEN_REF_AUDIO", str(ROOT / "voice-ref" / "ko_voice.wav"))
REF_TEXT = os.environ.get("QWEN_REF_TEXT", "")
SPEAKER = os.environ.get("QWEN_SPEAKER", "Sohee")
INSTRUCT = os.environ.get("QWEN_INSTRUCT", "")
LANGUAGE = os.environ.get("QWEN_LANGUAGE", "Korean")


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg: str) -> None:
    sys.stderr.write(f"[Qwen3-TTS] {msg}\n")
    sys.stderr.flush()


def pick_device(torch):
    if DEVICE_PREF in ("mps", "cuda", "cpu"):
        return DEVICE_PREF
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def file_sha(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()[:12]


def main() -> None:
    t0 = time.time()
    emit({"type": "status", "status": "loading", "model": MODEL_ID})
    try:
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")  # phép toán MPS chưa hỗ trợ => tự chạy CPU
        import numpy as np
        import soundfile as sf
        import torch
        from qwen_tts import Qwen3TTSModel

        device = pick_device(torch)
        # bfloat16 trên GPU (nhẹ, nhanh); CPU dùng float32 cho ổn định
        dtype = torch.bfloat16 if device in ("cuda", "mps") else torch.float32
        model = Qwen3TTSModel.from_pretrained(MODEL_ID, device_map=device, dtype=dtype)

        voice_key = f"speaker:{SPEAKER}:{INSTRUCT}"
        clone_prompt = None
        if MODE == "clone":
            if not os.path.isfile(REF_AUDIO):
                raise FileNotFoundError(f"Không thấy file giọng mẫu {REF_AUDIO} (tạo bằng tools/design_voice.py)")
            ref_text = REF_TEXT
            txt_path = Path(REF_AUDIO).with_suffix(".txt")
            if not ref_text and txt_path.is_file():
                ref_text = txt_path.read_text("utf-8").strip()
            # Dựng "dấu vân giọng" 1 lần, dùng lại cho mọi câu => nhanh và giọng ổn định
            clone_prompt = model.create_voice_clone_prompt(
                ref_audio=REF_AUDIO,
                ref_text=ref_text or None,
                x_vector_only_mode=not bool(ref_text),
            )
            voice_key = f"clone:{file_sha(REF_AUDIO)}"

        def synth(text: str):
            if MODE == "clone":
                wavs, sr = model.generate_voice_clone(text=text, language=LANGUAGE, voice_clone_prompt=clone_prompt)
            else:
                kw = {"instruct": INSTRUCT} if INSTRUCT else {}
                wavs, sr = model.generate_custom_voice(text=text, language=LANGUAGE, speaker=SPEAKER, **kw)
            wav = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
            peak = float(np.max(np.abs(wav))) if wav.size else 0.0
            if peak > 0.95:  # chống rè/xước khi phát
                wav = wav * (0.95 / peak)
            return wav, int(sr)

        # Khởi động nóng: câu đầu tiên luôn chậm nhất (biên dịch nhân GPU) => làm trước khi báo sẵn sàng
        synth("안녕하세요.")
        emit({"type": "ready", "model": f"qwen3-tts/{MODEL_ID.split('/')[-1]}", "voice": voice_key,
              "voices": [voice_key], "device": device, "loadSec": round(time.time() - t0, 1)})
        log(f"Sẵn sàng trên {device} sau {time.time() - t0:.1f}s ({MODE}, {MODEL_ID})")
    except Exception as exc:
        emit({"type": "error", "fatal": True, "error": f"{exc}", "trace": traceback.format_exc()[-1500:]})
        sys.exit(1)

    # Mô hình chiếm GPU => xử lý TUẦN TỰ từng câu (server đã có hàng đợi + chống trùng)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = clean_text(req.get("text") or "")
            if not text:
                emit({"type": "result", "id": req_id, "ok": False, "error": "Filtered empty/spam text"})
                continue
            key = hashlib.sha1(f"qwen1::{MODEL_ID}::{voice_key}::{LANGUAGE}::{text}".encode()).hexdigest()[:20]
            out_name = f"local_{key}.wav"
            out_path = CACHE_DIR / out_name
            if out_path.is_file() and out_path.stat().st_size > 1000:
                emit({"type": "result", "id": req_id, "ok": True, "cached": True, "voice": voice_key,
                      "file": out_name, "url": f"/tts-cache/{out_name}", "synthSec": 0.0})
                continue
            t1 = time.time()
            wav, sr = synth(text)
            tmp = out_path.with_suffix(".part.wav")
            sf.write(str(tmp), wav, sr, subtype="PCM_16")
            os.replace(tmp, out_path)
            emit({"type": "result", "id": req_id, "ok": True, "cached": False, "voice": voice_key,
                  "file": out_name, "url": f"/tts-cache/{out_name}", "synthSec": round(time.time() - t1, 2),
                  "durationSec": round(len(wav) / sr, 2)})
        except Exception as exc:
            emit({"type": "result", "id": req_id, "ok": False, "error": f"qwen3-tts: {exc}"})


if __name__ == "__main__":
    main()
