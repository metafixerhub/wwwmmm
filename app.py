import os
import uuid
import time
import shutil
import base64
import threading
from typing import Dict, Any, List, Optional
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from engine.video_utils import get_video_metadata, extract_frame_at, get_ffmpeg_path
from engine.inpainter import WatermarkInpainter
from engine.processor import VideoProcessor

# Paths
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
STATIC_DIR = BASE_DIR / "static"

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

app = FastAPI(
    title="CrystalClear Video Watermark Remover",
    description="High-precision video watermark removal with real-time preview and ETA estimation",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for active tasks and processors
tasks: Dict[str, Dict[str, Any]] = {}
processors: Dict[str, VideoProcessor] = {}


class RegionItem(BaseModel):
    x: int
    y: int
    width: int
    height: int
    start_frame: Optional[int] = None
    end_frame: Optional[int] = None


class PreviewRequest(BaseModel):
    video_id: str
    regions: List[RegionItem]
    timestamp: Optional[float] = 0.0
    frame_idx: Optional[int] = 0
    mode: str = "crystal_clear"
    inpaint_radius: int = 5
    feather_radius: int = 4


class ProcessRequest(BaseModel):
    video_id: str
    regions: List[RegionItem]
    mode: str = "crystal_clear"
    inpaint_radius: int = 5
    feather_radius: int = 4
    temporal_blend: float = 0.3


@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """
    Handles video upload, extracts metadata and generates a high-res initial frame.
    """
    video_id = str(uuid.uuid4())[:8]
    ext = os.path.splitext(file.filename)[1].lower()
    if not ext:
        ext = ".mp4"

    save_path = UPLOAD_DIR / f"{video_id}{ext}"

    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        meta = get_video_metadata(str(save_path))
    except Exception as e:
        if save_path.exists():
            os.remove(save_path)
        raise HTTPException(status_code=400, detail=f"Invalid video file: {str(e)}")

    # Extract first frame
    frame = extract_frame_at(str(save_path), frame_idx=0)
    frame_b64 = ""
    if frame is not None:
        _, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        frame_b64 = base64.b64encode(buf).decode("utf-8")

    return {
        "video_id": video_id,
        "filename": file.filename,
        "file_url": f"/api/video/{video_id}",
        "metadata": meta,
        "preview_frame": f"data:image/jpeg;base64,{frame_b64}" if frame_b64 else None
    }


@app.get("/api/frame")
async def get_frame(video_id: str, timestamp: Optional[float] = None, frame_idx: Optional[int] = None):
    """
    Retrieves a frame at a specific timestamp or frame index.
    """
    video_files = list(UPLOAD_DIR.glob(f"{video_id}.*"))
    if not video_files:
        raise HTTPException(status_code=404, detail="Video not found")

    video_path = str(video_files[0])
    frame = extract_frame_at(video_path, frame_idx=frame_idx, timestamp=timestamp)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")

    _, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    frame_b64 = base64.b64encode(buf).decode("utf-8")

    return {
        "frame_image": f"data:image/jpeg;base64,{frame_b64}"
    }


@app.post("/api/preview")
async def preview_removal(req: PreviewRequest):
    """
    Performs instantaneous single-frame inpainting for real-time user verification.
    """
    video_files = list(UPLOAD_DIR.glob(f"{req.video_id}.*"))
    if not video_files:
        raise HTTPException(status_code=404, detail="Video not found")

    video_path = str(video_files[0])
    frame = extract_frame_at(video_path, frame_idx=req.frame_idx, timestamp=req.timestamp)
    if frame is None:
        frame = extract_frame_at(video_path, frame_idx=0)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not extract frame for preview")

    inpainter = WatermarkInpainter(
        mode=req.mode,
        inpaint_radius=req.inpaint_radius,
        feather_radius=req.feather_radius,
        temporal_blend=0.0
    )

    regions_data = [r.model_dump() for r in req.regions]
    result_frame = inpainter.inpaint_frame(frame, regions_data, req.frame_idx or 0)

    # Encode original frame
    _, buf_orig = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    orig_b64 = base64.b64encode(buf_orig).decode("utf-8")

    # Encode result frame
    _, buf_res = cv2.imencode(".jpg", result_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    res_b64 = base64.b64encode(buf_res).decode("utf-8")

    return {
        "original_preview": f"data:image/jpeg;base64,{orig_b64}",
        "inpainted_preview": f"data:image/jpeg;base64,{res_b64}"
    }


def run_processor_thread(task_id: str, processor: VideoProcessor):
    """Worker function running in a separate background thread."""
    try:
        processor.process()
    except Exception as e:
        tasks[task_id]["status"] = "failed"
        tasks[task_id]["error"] = str(e)


@app.post("/api/process")
async def start_process(req: ProcessRequest):
    """
    Initiates asynchronous video watermark removal.
    """
    video_files = list(UPLOAD_DIR.glob(f"{req.video_id}.*"))
    if not video_files:
        raise HTTPException(status_code=404, detail="Video not found")

    video_path = str(video_files[0])
    task_id = str(uuid.uuid4())[:10]
    output_filename = f"removed_{task_id}.mp4"
    output_path = str(OUTPUT_DIR / output_filename)

    regions_data = [r.model_dump() for r in req.regions]

    # Initialize task state
    tasks[task_id] = {
        "task_id": task_id,
        "video_id": req.video_id,
        "status": "starting",
        "current_frame": 0,
        "total_frames": 0,
        "percent": 0.0,
        "fps": 0.0,
        "elapsed_seconds": 0.0,
        "eta_seconds": 0,
        "thumbnail": None,
        "output_path": None,
        "output_url": None,
        "error": None,
        "created_at": time.time()
    }

    def progress_callback(info: Dict[str, Any]):
        t = tasks.get(task_id)
        if t:
            t.update(info)
            if info.get("status") == "completed":
                t["output_url"] = f"/api/download/{task_id}"
                t["stream_url"] = f"/api/output_video/{task_id}"

    proc = VideoProcessor(
        input_video_path=video_path,
        output_video_path=output_path,
        regions=regions_data,
        mode=req.mode,
        inpaint_radius=req.inpaint_radius,
        feather_radius=req.feather_radius,
        temporal_blend=req.temporal_blend,
        progress_callback=progress_callback
    )

    processors[task_id] = proc

    thread = threading.Thread(target=run_processor_thread, args=(task_id, proc), daemon=True)
    thread.start()

    return {
        "task_id": task_id,
        "status": "queued"
    }


@app.get("/api/status/{task_id}")
async def get_task_status(task_id: str):
    """
    Fetches real-time status and ETA of a processing task.
    """
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/api/cancel/{task_id}")
async def cancel_task(task_id: str):
    """
    Cancels an active watermark removal job.
    """
    proc = processors.get(task_id)
    if proc:
        proc.cancel()
    if task_id in tasks:
        tasks[task_id]["status"] = "cancelled"
    return {"message": "Task cancelled successfully"}


@app.get("/api/video/{video_id}")
async def get_uploaded_video(video_id: str, request: Request):
    """
    Streams the uploaded source video supporting HTTP range requests for scrubbing.
    """
    video_files = list(UPLOAD_DIR.glob(f"{video_id}.*"))
    if not video_files:
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(str(video_files[0]), media_type="video/mp4")


@app.get("/api/output_video/{task_id}")
async def get_output_video_stream(task_id: str):
    """
    Streams the processed output video for in-browser playback and comparison.
    """
    task = tasks.get(task_id)
    if not task or not task.get("output_path") or not os.path.exists(task["output_path"]):
        raise HTTPException(status_code=404, detail="Output video not ready")
    return FileResponse(task["output_path"], media_type="video/mp4")


@app.get("/api/download/{task_id}")
async def download_output_video(task_id: str):
    """
    Downloads the finalized watermark-removed video.
    """
    task = tasks.get(task_id)
    if not task or not task.get("output_path") or not os.path.exists(task["output_path"]):
        raise HTTPException(status_code=404, detail="Output file not found")
    
    return FileResponse(
        task["output_path"],
        media_type="video/mp4",
        filename=f"watermark_removed_{task_id}.mp4"
    )


@app.post("/api/create_sample")
async def create_sample_video():
    """
    Generates a crisp demo video with an artificial watermark overlay
    so the user can immediately test the app with zero effort!
    """
    sample_id = "sample_demo"
    sample_path = UPLOAD_DIR / f"{sample_id}.mp4"

    if not sample_path.exists():
        # Generate a 5-second 1280x720 30fps smooth animated video
        width, height = 1280, 720
        fps = 30
        duration_sec = 4
        total_frames = fps * duration_sec

        ffmpeg_exe = get_ffmpeg_path()
        cmd = [
            ffmpeg_exe, "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-s", f"{width}x{height}",
            "-pix_fmt", "bgr24",
            "-r", str(fps),
            "-i", "-",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "veryfast",
            str(sample_path)
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

        # Generate frames: a colorful animated gradient landscape with a realistic watermark
        for f in range(total_frames):
            frame = np.zeros((height, width, 3), dtype=np.uint8)
            # Sky gradient
            t = f / total_frames
            color_top = np.array([180 + 30 * np.sin(t * 3), 120 + 20 * np.cos(t * 3), 40 + 20 * np.sin(t * 2)])
            color_bot = np.array([240, 200, 140])
            for y in range(height // 2):
                alpha = y / (height // 2)
                frame[y, :] = (color_top * (1 - alpha) + color_bot * alpha).astype(np.uint8)
            # Ocean waves
            for y in range(height // 2, height):
                wave = np.sin((y + f * 4) * 0.05) * 15
                frame[y, :] = [140 + int(wave), 70, 20]

            # Animated moving sun/orb
            orb_x = int(300 + 400 * np.sin(t * 2 * np.pi))
            orb_y = int(220 + 80 * np.cos(t * 2 * np.pi))
            cv2.circle(frame, (orb_x, orb_y), 55, (255, 240, 200), -1)

            # Watermark in top-right corner: Box + Text "WATERMARK © 2026"
            wm_x, wm_y, wm_w, wm_h = 920, 60, 300, 70
            sub_roi = frame[wm_y:wm_y+wm_h, wm_x:wm_x+wm_w]
            white_rect = np.full_like(sub_roi, (245, 245, 245))
            # Blended translucent badge
            cv2.addWeighted(sub_roi, 0.4, white_rect, 0.6, 0, sub_roi)
            cv2.rectangle(frame, (wm_x, wm_y), (wm_x + wm_w, wm_y + wm_h), (255, 255, 255), 2)
            cv2.putText(frame, "WATERMARK PRO", (wm_x + 20, wm_y + 45), cv2.FONT_HERSHEY_DUPLEX, 0.9, (20, 20, 180), 2, cv2.LINE_AA)

            proc.stdin.write(frame.tobytes())

        proc.stdin.close()
        proc.wait()

    meta = get_video_metadata(str(sample_path))
    frame0 = extract_frame_at(str(sample_path), frame_idx=0)
    _, buf = cv2.imencode(".jpg", frame0, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    frame_b64 = base64.b64encode(buf).decode("utf-8")

    return {
        "video_id": sample_id,
        "filename": "Sample_Watermarked_Video.mp4",
        "file_url": f"/api/video/{sample_id}",
        "metadata": meta,
        "preview_frame": f"data:image/jpeg;base64,{frame_b64}",
        "suggested_region": {
            "x": 910,
            "y": 50,
            "width": 320,
            "height": 90
        }
    }


# Mount static files at root
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
