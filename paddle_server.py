"""Local FastAPI server for PaddleOCR-based visual text finding."""
from __future__ import annotations
import io, os, threading
from pathlib import Path
from typing import Any
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
MAX_IMAGE_BYTES = 20 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/bmp"}
# Avoid Windows profile/cache permission issues. Models and Paddle runtime files
# stay beside this tool instead of being written under the user home directory.
PADDLE_CACHE = ROOT / ".paddle-cache"
PADDLE_CACHE.mkdir(exist_ok=True)
os.environ.setdefault("PADDLE_HOME", str(PADDLE_CACHE / "paddle"))
os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(PADDLE_CACHE / "paddlex"))
os.environ.setdefault("XDG_CACHE_HOME", str(PADDLE_CACHE))
# PaddlePaddle 3.2 still derives its dataset cache from expanduser("~") on
# Windows, so HOME must also be redirected before Paddle is imported.
os.environ["HOME"] = str(PADDLE_CACHE)
os.environ["USERPROFILE"] = str(PADDLE_CACHE)
app = FastAPI(title="文字雷達 PaddleOCR", docs_url=None, redoc_url=None)
_ocr: Any | None = None
_ocr_lock = threading.Lock()

def get_ocr() -> Any:
    global _ocr
    if _ocr is None:
        with _ocr_lock:
            if _ocr is None:
                from paddleocr import PaddleOCR
                _ocr = PaddleOCR(
                    lang="chinese_cht", device="cpu", enable_hpi=False,
                    enable_mkldnn=False, enable_cinn=False,
                    use_doc_orientation_classify=False, use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
    return _ocr

def as_polygon(points: Any) -> list[list[float]]:
    return [[float(point[0]), float(point[1])] for point in points]

def run_ocr(image: np.ndarray) -> list[dict[str, Any]]:
    """Adapt PaddleOCR 3.x prediction output to the browser item format."""
    prediction = next(iter(get_ocr().predict(image)), None)
    if prediction is None: return []
    raw = prediction.json
    if callable(raw):
        raw = raw()
    data = raw["res"] if isinstance(raw, dict) and "res" in raw else raw
    texts, scores = data.get("rec_texts", []), data.get("rec_scores", [])
    polygons = data.get("rec_polys", data.get("dt_polys", []))
    return [{"text": str(text), "score": float(score), "poly": as_polygon(polygon)} for text, score, polygon in zip(texts, scores, polygons) if str(text).strip() and polygon is not None]

@app.get("/")
def index() -> FileResponse:
    return FileResponse(ROOT / "index.html")

@app.post("/api/ocr")
async def ocr(image: UploadFile = File(...), upscale: bool = Form(False)) -> dict[str, list[dict[str, Any]]]:
    if image.content_type not in ALLOWED_TYPES: raise HTTPException(415, "只支援 PNG、JPG、WEBP、BMP 圖片。")
    content = await image.read()
    if not content or len(content) > MAX_IMAGE_BYTES: raise HTTPException(413, "圖片必須介於 1 byte 與 20 MB 之間。")
    try: pil_image = Image.open(io.BytesIO(content)).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc: raise HTTPException(400, "無法讀取圖片檔案。") from exc
    try:
        if upscale:
            scaled = pil_image.resize((pil_image.width * 2, pil_image.height * 2), Image.Resampling.LANCZOS)
            items = run_ocr(np.asarray(scaled))
            for item in items: item["poly"] = [[x / 2, y / 2] for x, y in item["poly"]]
        else: items = run_ocr(np.asarray(pil_image))
    except Exception as exc:
        raise HTTPException(503, f"PaddleOCR 無法載入模型或進行辨識：{exc}") from exc
    return {"items": items}

# Keep this mount last so /api/ocr remains an API route while app.js, match.js,
# CSS, and images are served from the same local origin.
app.mount("/", StaticFiles(directory=ROOT, html=True), name="frontend")
