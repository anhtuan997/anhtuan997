#!/usr/bin/env python3
"""
Worker giọng đọc qua API Vibi (https://vibi.pro) — bán lại giọng ElevenLabs, MiniMax, CapCut.
- Giao thức GIỐNG HỆT tts_worker.py / tts_worker_edge.py: stdin 1 JSON/dòng {id, text, voice},
  stdout 1 JSON/dòng {type: status|ready|result|error}. server.js dùng chung.
- Luồng API Vibi: POST /v1/text-to-speech/{voice_id} -> 202 {id} -> hỏi GET /v1/history/{id}
  tới khi status=completed -> tải result.audio_url -> lưu đệm data/tts-cache/vibi_<hash>.mp3
- Chạy 24/7 an toàn về chi phí: giới hạn số ký tự / ngày (VIBI_DAILY_CHAR_LIMIT). Vượt giới hạn,
  hết tín dụng hoặc Vibi lỗi => tự chuyển sang edge-tts (miễn phí) nếu đã cài.
- Chỉ dùng thư viện chuẩn của Python (không cần pip install gì thêm cho Vibi).

Biến môi trường:
  VIBI_API_KEY          (bắt buộc) khoá API lấy ở trang Tài liệu API của Vibi — KHÔNG commit lên Git
  VIBI_VOICE_ID         (bắt buộc) mã giọng, tìm bằng: node tools/vibi-voices.js --lang ko --gender female
  VIBI_PROVIDER         elevenlabs (mặc định) | minimax | capcut
  VIBI_MODEL            mặc định: eleven_multilingual_v2 / speech-2.8-turbo / capcut theo nhà cung cấp
  VIBI_LANGUAGE         ElevenLabs/CapCut: mã ISO (ko, vi). MiniMax: tên đầy đủ (Korean, Vietnamese)
  VIBI_SPEED            tốc độ đọc, mặc định 1.0
  VIBI_STABILITY        [ElevenLabs] độ ổn định 0–1, mặc định 0.5
  VIBI_SIMILARITY       [ElevenLabs] độ giống giọng gốc 0–1, mặc định 0.75
  VIBI_DAILY_CHAR_LIMIT số ký tự tối đa gửi Vibi mỗi ngày, mặc định 30000 (0 = không giới hạn)
  VIBI_BASE_URL         mặc định https://api.vibi.pro
"""
import asyncio
import hashlib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tts_worker_edge import clean_text, patch_ca_bundle  # noqa: E402  (dùng chung bộ lọc chữ)

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "data" / "tts-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
USAGE_FILE = ROOT / "data" / "vibi-usage.json"

BASE_URL = os.environ.get("VIBI_BASE_URL", "https://api.vibi.pro").rstrip("/")
API_KEY = os.environ.get("VIBI_API_KEY", "").strip()
VOICE_ID = os.environ.get("VIBI_VOICE_ID", "").strip()
PROVIDER = os.environ.get("VIBI_PROVIDER", "elevenlabs").strip().lower()
DEFAULT_MODELS = {"elevenlabs": "eleven_multilingual_v2", "minimax": "speech-2.8-turbo", "capcut": "capcut"}
MODEL = os.environ.get("VIBI_MODEL", DEFAULT_MODELS.get(PROVIDER, "eleven_multilingual_v2"))
DEFAULT_LANG = {"elevenlabs": "ko", "minimax": "Korean", "capcut": "vi"}
LANGUAGE = os.environ.get("VIBI_LANGUAGE", DEFAULT_LANG.get(PROVIDER, "ko"))
SPEED = float(os.environ.get("VIBI_SPEED", "1.0"))
STABILITY = float(os.environ.get("VIBI_STABILITY", "0.5"))
SIMILARITY = float(os.environ.get("VIBI_SIMILARITY", "0.75"))
DAILY_LIMIT = int(os.environ.get("VIBI_DAILY_CHAR_LIMIT", "30000"))
FALLBACK_VOICE = os.environ.get("EDGE_TTS_VOICE", "ko-KR-SunHiNeural")
POLL_TIMEOUT_SEC = 45
# Vibi (sau Cloudflare) trả 403 cho User-Agent mặc định "Python-urllib/x.y" => phải tự đặt tên trình gửi
USER_AGENT = "tiktok-live-temple-rpc/1.0 (+tts_worker_vibi)"

_out_lock = threading.Lock()
_usage_lock = threading.Lock()


def emit(payload: dict) -> None:
    with _out_lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def log(msg: str) -> None:
    sys.stderr.write(f"[Vibi] {msg}\n")
    sys.stderr.flush()


# ---------------------------------------------------------------------------
# Giới hạn chi phí theo ngày
# ---------------------------------------------------------------------------
def _today() -> str:
    return time.strftime("%Y-%m-%d")


def reserve_chars(n: int) -> bool:
    """Trừ trước n ký tự vào hạn mức hôm nay. False = đã hết hạn mức."""
    if DAILY_LIMIT <= 0:
        return True
    with _usage_lock:
        try:
            usage = json.loads(USAGE_FILE.read_text("utf-8"))
        except Exception:
            usage = {}
        used = int(usage.get(_today(), 0))
        if used + n > DAILY_LIMIT:
            return False
        usage = {_today(): used + n}  # chỉ giữ hôm nay
        tmp = USAGE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(usage), "utf-8")
        os.replace(tmp, USAGE_FILE)
        return True


# ---------------------------------------------------------------------------
# Gọi API Vibi
# ---------------------------------------------------------------------------
class VibiError(Exception):
    pass


def http_json(method: str, path: str, body=None, timeout=20):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={"xi-api-key": API_KEY, "Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise VibiError(f"HTTP {exc.code}: {detail}") from exc


def download(url: str, dest: Path) -> None:
    if url.startswith("/"):
        url = BASE_URL + url
    req = urllib.request.Request(url, headers={"xi-api-key": API_KEY, "User-Agent": USER_AGENT})
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(req, timeout=30) as resp, open(tmp, "wb") as fh:
        fh.write(resp.read())
    if tmp.stat().st_size < 500:
        tmp.unlink(missing_ok=True)
        raise VibiError("File âm thanh quá ngắn")
    os.replace(tmp, dest)


def build_payload(text: str) -> dict:
    settings = {"speed": SPEED}
    if PROVIDER == "elevenlabs":
        settings.update({"stability": STABILITY, "similarity_boost": SIMILARITY})
    payload = {"text": text, "provider": PROVIDER, "language_code": LANGUAGE, "voice_settings": settings}
    if PROVIDER != "capcut":
        payload["model_id"] = MODEL
    return payload


def synth_vibi(text: str, dest: Path) -> None:
    status, data = http_json("POST", f"/v1/text-to-speech/{urllib.parse.quote(VOICE_ID)}", build_payload(text))
    task_id = data.get("id")
    if not task_id:
        raise VibiError(f"Không nhận được mã tác vụ: {str(data)[:200]}")
    deadline = time.time() + POLL_TIMEOUT_SEC
    delay = 0.6
    while time.time() < deadline:
        time.sleep(delay)
        delay = min(2.0, delay * 1.4)
        _, task = http_json("GET", f"/v1/history/{task_id}")
        st = task.get("status")
        if st == "completed":
            url = (task.get("result") or {}).get("audio_url") or task.get("audio_url")
            if not url:
                raise VibiError("Tác vụ xong nhưng không có audio_url")
            download(url, dest)
            return
        if st == "failed":
            raise VibiError(f"Vibi báo lỗi: {task.get('error')}")
    raise VibiError("Quá thời gian chờ Vibi")


# ---------------------------------------------------------------------------
# Dự phòng miễn phí: edge-tts
# ---------------------------------------------------------------------------
def synth_edge(text: str, dest: Path) -> bool:
    try:
        import edge_tts  # noqa: WPS433
    except Exception:
        return False

    async def run():
        await edge_tts.Communicate(text, FALLBACK_VOICE, rate=os.environ.get("EDGE_TTS_RATE", "-5%")).save(str(dest))

    try:
        asyncio.run(run())
        return dest.is_file() and dest.stat().st_size > 500
    except Exception as exc:
        log(f"edge-tts dự phòng cũng lỗi: {exc}")
        return False


def handle(req: dict) -> None:
    req_id = req.get("id")
    try:
        text = clean_text(req.get("text") or "")
        if not text:
            emit({"type": "result", "id": req_id, "ok": False, "error": "Filtered empty/spam text"})
            return
        key = hashlib.sha1(f"vibi1::{PROVIDER}::{VOICE_ID}::{MODEL}::{LANGUAGE}::{SPEED}::{text}".encode()).hexdigest()[:20]
        out_name = f"vibi_{key}.mp3"
        dest = CACHE_DIR / out_name
        if dest.is_file() and dest.stat().st_size > 500:
            emit({"type": "result", "id": req_id, "ok": True, "cached": True, "voice": VOICE_ID,
                  "file": out_name, "url": f"/tts-cache/{out_name}", "synthSec": 0.0})
            return
        t0 = time.time()
        engine = "vibi"
        try:
            if not reserve_chars(len(text)):
                raise VibiError(f"Đã dùng hết hạn mức {DAILY_LIMIT} ký tự hôm nay")
            synth_vibi(text, dest)
        except Exception as exc:
            log(f"{exc} => chuyển sang edge-tts")
            out_name = f"edgefb_{key}.mp3"
            dest = CACHE_DIR / out_name
            if not synth_edge(text, dest):
                raise
            engine = "edge-fallback"
        emit({"type": "result", "id": req_id, "ok": True, "cached": False, "voice": VOICE_ID, "engine": engine,
              "file": out_name, "url": f"/tts-cache/{out_name}", "synthSec": round(time.time() - t0, 2)})
    except Exception as exc:
        emit({"type": "result", "id": req_id, "ok": False, "error": f"vibi: {exc}"})


def main() -> None:
    emit({"type": "status", "status": "loading", "model": f"vibi/{PROVIDER}"})
    patch_ca_bundle()
    if not API_KEY or not VOICE_ID:
        emit({"type": "error", "fatal": True,
              "error": "Thiếu VIBI_API_KEY hoặc VIBI_VOICE_ID (tìm giọng: node tools/vibi-voices.js)"})
        sys.exit(1)
    emit({"type": "ready", "model": f"vibi/{PROVIDER}/{MODEL}", "voice": VOICE_ID, "voices": [VOICE_ID], "loadSec": 0.0})
    pool = ThreadPoolExecutor(max_workers=3)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        pool.submit(handle, req)
    pool.shutdown(wait=True)


if __name__ == "__main__":
    main()
