"""Private YouTube -> Telegram video-delivery sidecar for Rasadino.

Only use for videos you own or are authorized to download. No DRM bypass.
Runs on a separate Python host, not Cloudflare Workers.
"""
import hmac
import os
import re
import tempfile
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
import yt_dlp
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_slot = threading.BoundedSemaphore(1)
MAX_BYTES = 45 * 1024 * 1024
MAX_SECONDS = 20 * 60
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


class Job(BaseModel):
    chat_id: str = Field(pattern=r"^[0-9]{1,20}$")
    youtube_url: str = Field(max_length=500)


def canonical_video_url(raw: str) -> str | None:
    if not raw or any(c.isspace() for c in raw) or len(raw) > 500:
        return None
    try:
        u = urlparse(raw)
        if u.scheme != "https" or u.port or u.username or u.password or u.fragment and len(u.fragment) > 100:
            return None
        host = (u.hostname or "").lower()
        path = [x for x in u.path.split("/") if x]
        if host in ("youtu.be", "www.youtu.be") and len(path) == 1:
            video_id = path[0]
        elif host in ("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"):
            if path == ["watch"]:
                video_id = parse_qs(u.query).get("v", [None])[0]
            elif len(path) == 2 and path[0] in ("shorts", "live", "embed"):
                video_id = path[1]
            else:
                return None
        else:
            return None
        return "https://www.youtube.com/watch?v=" + video_id if video_id and VIDEO_ID.fullmatch(video_id) else None
    except ValueError:
        return None


def _telegram(method: str, *, data: dict, video_path: Path | None = None) -> None:
    token = os.environ["BOT_TOKEN"]
    url = "https://api.telegram.org/bot" + token + "/" + method
    if video_path:
        with video_path.open("rb") as fp:
            response = requests.post(
                url, data=data, files={"video": (video_path.name, fp, "video/mp4")},
                timeout=(15, 180),
            )
    else:
        response = requests.post(url, json=data, timeout=(15, 20))
    response.raise_for_status()
    if not response.json().get("ok"):
        raise RuntimeError("Telegram rejected the request")


def _process_job(job: Job) -> None:
    try:
        with tempfile.TemporaryDirectory(prefix="rasadino-yt-") as directory:
            settings = {
                "format": "best[ext=mp4][height<=480]/best[ext=mp4][height<=720]",
                "outtmpl": str(Path(directory) / "video.%(ext)s"),
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "retries": 1,
                "socket_timeout": 20,
                "max_filesize": MAX_BYTES,
                "ignoreerrors": False,
                "writethumbnail": False,
                "writeinfojson": False,
            }
            with yt_dlp.YoutubeDL(settings) as dl:
                metadata = dl.extract_info(job.youtube_url, download=False)
                if not metadata or metadata.get("is_live") or metadata.get("duration", 0) > MAX_SECONDS:
                    raise ValueError("Video not supported")
                result = dl.extract_info(job.youtube_url, download=True)
                if not result:
                    raise ValueError("No downloadable media")
                title = str(result.get("title") or "YouTube video").replace("\n", " ").strip()[:90]
            files = [p for p in Path(directory).iterdir() if p.is_file() and p.suffix == ".mp4"]
            if len(files) != 1 or not (0 < files[0].stat().st_size <= MAX_BYTES):
                raise ValueError("Unsupported file format or size")
            _telegram(
                "sendVideo",
                data={"chat_id": job.chat_id, "caption": title, "supports_streaming": "true"},
                video_path=files[0],
            )
    except Exception:
        # Never leak URLs, tokens or platform-internal details to chat or logs.
        try:
            _telegram("sendMessage", data={
                "chat_id": job.chat_id, "text": "⚠️ دریافت این ویدئو ممکن نشد."
            })
        except Exception:
            pass
    finally:
        _slot.release()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/jobs", status_code=202)
def submit(job: Job, tasks: BackgroundTasks, x_download_key: str | None = Header(default=None)):
    secret = os.getenv("DOWNLOAD_API_KEY", "")
    token = os.getenv("BOT_TOKEN", "")
    owner = os.getenv("OWNER_CHAT_ID", "")
    if not secret or not token or not owner:
        raise HTTPException(status_code=503, detail="Not configured")
    if not x_download_key or not hmac.compare_digest(x_download_key, secret):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if job.chat_id != owner:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not canonical_video_url(job.youtube_url):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")
    if not _slot.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Busy")
    tasks.add_task(_process_job, job)
    return {"accepted": True}
