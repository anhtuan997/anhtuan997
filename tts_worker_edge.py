#!/usr/bin/env python3
"""
Worker giọng đọc trực tuyến dùng thư viện edge-tts (giọng thần kinh của Microsoft).
- Dùng cho tiếng Hàn (ko-KR-SunHiNeural, ko-KR-InJoonNeural...) và mọi ngôn ngữ khác.
- Giao thức GIỐNG HỆT tts_worker.py (ZeroTTS): mỗi dòng stdin là 1 JSON {id, text, voice},
  mỗi dòng stdout là 1 JSON {type: status|ready|result|error, ...} => server.js dùng chung.
- Tổng hợp song song tối đa 3 câu, tự thử lại 2 lần khi mạng chập chờn, lưu đệm theo hash.

Cài đặt:  pip install edge-tts      (cần Internet khi chạy)
Biến môi trường:
  EDGE_TTS_VOICE   giọng mặc định (mặc định ko-KR-SunHiNeural)
  EDGE_TTS_RATE    tốc độ đọc, ví dụ "-5%" (chậm hơn 5%)
  EDGE_TTS_PITCH   cao độ, ví dụ "+0Hz"
  EDGE_TTS_CA_FILE file chứng chỉ gốc riêng (chỉ cần khi mạng công ty chặn/soi HTTPS)
"""
import asyncio
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent / "data" / "tts-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_VOICE = os.environ.get("EDGE_TTS_VOICE", "ko-KR-SunHiNeural")
RATE = os.environ.get("EDGE_TTS_RATE", "-5%")
PITCH = os.environ.get("EDGE_TTS_PITCH", "+0Hz")
MAX_PARALLEL = 3

# Danh sách giọng hay dùng (tra cứu không phân biệt hoa/thường vì phía trình duyệt có thể gửi chữ thường)
KNOWN_VOICES = [
    "ko-KR-SunHiNeural",
    "ko-KR-InJoonNeural",
    "ko-KR-HyunsuMultilingualNeural",
    "vi-VN-HoaiMyNeural",
    "vi-VN-NamMinhNeural",
    "en-US-JennyNeural",
]
VOICE_LOOKUP = {v.lower(): v for v in KNOWN_VOICES}
VOICE_PATTERN = re.compile(r"^[a-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+Neural$")

# Giữ: chữ Hàn (Hangul), chữ Latin + dấu tiếng Việt, số, dấu câu cơ bản. Xoá emoji / ký tự rác.
ALLOWED_RE = re.compile(
    r"[^0-9a-zA-ZÀ-ỹĂăĐđĨĩŨũƠơƯưᄀ-ᇿ㄰-㆏가-힣\s.,!?~]"
)
BRACKET_EMOTE_RE = re.compile(r"\[[^\]]{1,24}\]")
REPEATED_CHARS_RE = re.compile(r"(.)\1{2,}")
MULTI_PUNCT_RE = re.compile(r"([.,!?~])\1+")
MULTI_SPACE_RE = re.compile(r"\s+")
LETTER_RE = re.compile(r"[a-zA-ZÀ-ỹ가-힣㄰-㆏]")


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def resolve_voice(raw: str) -> str:
    v = (raw or "").strip()
    if not v or v.lower() in ("maichi", "default"):
        return DEFAULT_VOICE
    if v.lower() in VOICE_LOOKUP:
        return VOICE_LOOKUP[v.lower()]
    if VOICE_PATTERN.match(v):
        return v
    return DEFAULT_VOICE


def clean_text(raw: str) -> str:
    if not raw:
        return ""
    text = unicodedata.normalize("NFC", unicodedata.normalize("NFKC", str(raw)))
    text = BRACKET_EMOTE_RE.sub(" ", text)
    # "ㅋㅋㅋㅋ" / "ㅠㅠㅠ" (cười / khóc kiểu Hàn) đọc lên rất khó nghe => bỏ hẳn
    text = re.sub(r"[ㄱ-ㅎㅏ-ㅣ]{2,}", " ", text)
    text = ALLOWED_RE.sub(" ", text)
    text = text.replace("~", " ")
    text = MULTI_PUNCT_RE.sub(r"\1", text)
    text = REPEATED_CHARS_RE.sub(r"\1\1", text)
    text = MULTI_SPACE_RE.sub(" ", text).strip(" .,!?-")
    if len(LETTER_RE.findall(text)) < 2:
        return ""
    if len(text) > 220:
        text = text[:220].rsplit(" ", 1)[0]
    if text[-1] not in ".!?":
        text += "."
    return text


def patch_ca_bundle() -> None:
    """edge-tts luôn dùng chứng chỉ của certifi. Mạng công ty / proxy soi HTTPS cần chứng chỉ riêng."""
    ca_file = os.environ.get("EDGE_TTS_CA_FILE") or os.environ.get("SSL_CERT_FILE")
    if ca_file and os.path.isfile(ca_file):
        try:
            import certifi  # noqa: WPS433

            certifi.where = lambda: ca_file  # type: ignore[assignment]
        except Exception:
            pass


async def synth_one(edge_tts, req: dict, sem: asyncio.Semaphore) -> None:
    req_id = req.get("id")
    try:
        voice = resolve_voice(req.get("voice"))
        text = clean_text(req.get("text") or "")
        if not text:
            emit({"type": "result", "id": req_id, "ok": False, "error": "Filtered empty/spam text"})
            return
        key = hashlib.sha1(f"edge1::{voice}::{RATE}::{PITCH}::{text}".encode("utf-8")).hexdigest()[:20]
        out_name = f"edge_{key}.mp3"
        out_path = CACHE_DIR / out_name
        if out_path.is_file() and out_path.stat().st_size > 500:
            emit({"type": "result", "id": req_id, "ok": True, "cached": True, "voice": voice,
                  "file": out_name, "url": f"/tts-cache/{out_name}", "synthSec": 0.0})
            return

        async with sem:
            t0 = time.time()
            last_err = None
            for attempt in range(3):
                tmp_path = out_path.with_suffix(f".{attempt}.part")
                try:
                    comm = edge_tts.Communicate(text, voice, rate=RATE, pitch=PITCH)
                    await asyncio.wait_for(comm.save(str(tmp_path)), timeout=25)
                    if tmp_path.stat().st_size < 500:
                        raise RuntimeError("Âm thanh trả về quá ngắn")
                    os.replace(tmp_path, out_path)
                    last_err = None
                    break
                except Exception as exc:  # mạng chập chờn => chờ rồi thử lại
                    last_err = exc
                    try:
                        tmp_path.unlink()
                    except OSError:
                        pass
                    await asyncio.sleep(1.5 * (attempt + 1))
            if last_err is not None:
                raise last_err
        emit({"type": "result", "id": req_id, "ok": True, "cached": False, "voice": voice,
              "file": out_name, "url": f"/tts-cache/{out_name}", "synthSec": round(time.time() - t0, 2)})
    except Exception as exc:
        emit({"type": "result", "id": req_id, "ok": False, "error": f"edge-tts: {exc}"})


async def main() -> None:
    emit({"type": "status", "status": "loading", "model": "edge-tts"})
    patch_ca_bundle()
    try:
        import edge_tts  # noqa: WPS433
    except Exception as exc:
        emit({"type": "error", "fatal": True,
              "error": f"Chưa cài edge-tts ({exc}). Chạy: pip install edge-tts"})
        sys.exit(1)

    emit({"type": "ready", "model": "edge-tts", "voice": DEFAULT_VOICE,
          "voices": KNOWN_VOICES, "loadSec": 0.0})

    sem = asyncio.Semaphore(MAX_PARALLEL)
    loop = asyncio.get_running_loop()
    tasks = set()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        task = asyncio.create_task(synth_one(edge_tts, req, sem))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
