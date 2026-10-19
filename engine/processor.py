import os
import time
import base64
import subprocess
import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Callable
from engine.video_utils import get_video_metadata, get_ffmpeg_path, mux_audio_and_finalize
from engine.inpainter import WatermarkInpainter


class VideoProcessor:
    """
    Executes frame-by-frame video watermark removal with real-time progress,
    ETA calculation, audio preservation, and cancellation support.
    """

    def __init__(
        self,
        input_video_path: str,
        output_video_path: str,
        regions: List[Dict[str, Any]],
        mode: str = "crystal_clear",
        inpaint_radius: int = 5,
        feather_radius: int = 4,
        temporal_blend: float = 0.3,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None
    ):
        self.input_path = input_video_path
        self.output_path = output_video_path
        self.regions = regions
        self.mode = mode
        self.inpaint_radius = inpaint_radius
        self.feather_radius = feather_radius
        self.temporal_blend = temporal_blend
        self.progress_callback = progress_callback
        self.is_cancelled = False

    def cancel(self):
        """Signals the processor to abort."""
        self.is_cancelled = True

    def process(self) -> str:
        """
        Runs the video processing pipeline.
        Returns the path to the finalized video file.
        """
        meta = get_video_metadata(self.input_path)
        width = meta["width"]
        height = meta["height"]
        fps = meta["fps"]
        total_frames = meta["total_frames"]
        has_audio = meta["has_audio"]

        inpainter = WatermarkInpainter(
            mode=self.mode,
            inpaint_radius=self.inpaint_radius,
            feather_radius=self.feather_radius,
            temporal_blend=self.temporal_blend
        )

        # Temporary path for video-only stream
        temp_dir = os.path.dirname(os.path.abspath(self.output_path))
        temp_video_path = os.path.join(temp_dir, f"temp_{os.path.basename(self.output_path)}")

        ffmpeg_exe = get_ffmpeg_path()

        # Pipe raw RGB24 or BGR24 frames into FFmpeg for high-speed H.264 encoding
        # Using crf 19 for crystal clear visual quality and preset 'veryfast' for responsive speed
        ffmpeg_cmd = [
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
            "-crf", "19",
            temp_video_path
        ]

        pipe_proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

        cap = cv2.VideoCapture(self.input_path)
        if not cap.isOpened():
            pipe_proc.kill()
            raise RuntimeError(f"Could not open input video: {self.input_path}")

        frame_count = 0
        start_time = time.time()
        last_progress_time = 0.0

        try:
            while True:
                if self.is_cancelled:
                    break

                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                # Process the frame
                processed_frame = inpainter.inpaint_frame(frame, self.regions, frame_count)

                # Write frame to FFmpeg pipe
                try:
                    pipe_proc.stdin.write(processed_frame.tobytes())
                except (BrokenPipeError, OSError):
                    break

                frame_count += 1
                now = time.time()

                # Report progress throttled to 10-15 updates per second
                if now - last_progress_time > 0.1 or frame_count >= total_frames:
                    elapsed = now - start_time
                    current_fps = frame_count / elapsed if elapsed > 0 else 0
                    pct = min(100.0, round((frame_count / total_frames) * 100, 1))

                    remaining_frames = max(0, total_frames - frame_count)
                    eta_seconds = round(remaining_frames / current_fps) if current_fps > 0 else 0

                    # Convert sample preview thumbnail (every ~30 frames)
                    thumb_b64 = None
                    if frame_count % 30 == 1 or frame_count == total_frames:
                        # Resize thumbnail to max 320px width for fast web transfer
                        th_h, th_w = processed_frame.shape[:2]
                        scale = min(1.0, 320.0 / th_w)
                        small_thumb = cv2.resize(processed_frame, (int(th_w * scale), int(th_h * scale)))
                        _, buf = cv2.imencode(".jpg", small_thumb, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
                        thumb_b64 = base64.b64encode(buf).decode("utf-8")

                    if self.progress_callback:
                        self.progress_callback({
                            "status": "processing",
                            "current_frame": frame_count,
                            "total_frames": total_frames,
                            "percent": pct,
                            "fps": round(current_fps, 1),
                            "elapsed_seconds": round(elapsed, 1),
                            "eta_seconds": eta_seconds,
                            "thumbnail": thumb_b64
                        })
                    last_progress_time = now

        finally:
            cap.release()
            if pipe_proc.stdin:
                try:
                    pipe_proc.stdin.close()
                except Exception:
                    pass
            pipe_proc.wait()

        if self.is_cancelled:
            if os.path.exists(temp_video_path):
                os.remove(temp_video_path)
            raise RuntimeError("Video processing was cancelled by the user.")

        # Re-mux original audio into output video
        mux_success = mux_audio_and_finalize(temp_video_path, self.input_path, self.output_path, has_audio)

        # Cleanup temp file if output exists
        if os.path.exists(temp_video_path) and os.path.exists(self.output_path):
            try:
                os.remove(temp_video_path)
            except Exception:
                pass

        if not mux_success or not os.path.exists(self.output_path):
            raise RuntimeError("Failed to finalize processed video.")

        # Final progress notification
        total_time = round(time.time() - start_time, 1)
        if self.progress_callback:
            self.progress_callback({
                "status": "completed",
                "current_frame": frame_count,
                "total_frames": total_frames,
                "percent": 100.0,
                "fps": round(frame_count / total_time, 1) if total_time > 0 else 0,
                "elapsed_seconds": total_time,
                "eta_seconds": 0,
                "output_path": self.output_path
            })

        return self.output_path
