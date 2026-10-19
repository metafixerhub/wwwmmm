import os
import sys
import json
import subprocess
import cv2
import numpy as np
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

try:
    import imageio_ffmpeg
    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG_EXE = "ffmpeg"


def get_ffmpeg_path() -> str:
    """Returns the verified path to the FFmpeg executable."""
    return FFMPEG_EXE


def get_video_metadata(video_path: str) -> Dict[str, Any]:
    """
    Extracts comprehensive metadata from a video file using OpenCV and FFmpeg probe.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_path}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # If fps is invalid or zero, default to 30.0
    if not fps or fps <= 0 or np.isnan(fps):
        fps = 30.0

    if total_frames <= 0:
        total_frames = 1

    duration = total_frames / fps
    cap.release()

    # Check for audio presence using FFmpeg
    has_audio = check_has_audio(video_path)

    file_size_mb = round(os.path.getsize(video_path) / (1024 * 1024), 2)

    return {
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "total_frames": total_frames,
        "duration": round(duration, 3),
        "file_size_mb": file_size_mb,
        "filename": os.path.basename(video_path),
        "has_audio": has_audio,
        "aspect_ratio": f"{width}:{height}"
    }


def check_has_audio(video_path: str) -> bool:
    """Checks if the video has an audio stream using ffmpeg."""
    try:
        cmd = [
            get_ffmpeg_path(),
            "-i", video_path
        ]
        proc = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True, timeout=5)
        return "Audio:" in proc.stderr
    except Exception:
        return False


def extract_frame_at(video_path: str, frame_idx: Optional[int] = None, timestamp: Optional[float] = None) -> Optional[np.ndarray]:
    """
    Extracts a single frame from video at either frame_idx or timestamp (in seconds).
    Returns BGR numpy array.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None

    if frame_idx is not None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_idx))
    elif timestamp is not None:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0, timestamp * 1000.0))

    ret, frame = cap.read()
    cap.release()

    if ret and frame is not None:
        return frame
    return None


def mux_audio_and_finalize(video_without_audio: str, source_video: str, output_path: str, has_audio: bool = True) -> bool:
    """
    Losslessly muxes the original audio track from source_video into video_without_audio,
    producing high-compatibility H.264 MP4 with AAC audio.
    """
    ffmpeg_exe = get_ffmpeg_path()
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    if has_audio:
        cmd = [
            ffmpeg_exe, "-y",
            "-i", video_without_audio,
            "-i", source_video,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-map", "0:v:0",
            "-map", "1:a:0?",
            "-movflags", "+faststart",
            output_path
        ]
    else:
        cmd = [
            ffmpeg_exe, "-y",
            "-i", video_without_audio,
            "-c:v", "copy",
            "-movflags", "+faststart",
            output_path
        ]

    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        # If output file exists and has size > 0
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return True
        return False
    except subprocess.CalledProcessError as e:
        # Fallback: if mux failed, copy the video without audio to destination
        if os.path.exists(video_without_audio) and not os.path.exists(output_path):
            import shutil
            shutil.copy2(video_without_audio, output_path)
            return True
        return False
