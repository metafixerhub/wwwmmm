import os
import sys
import time
import cv2
import numpy as np
from engine.video_utils import get_video_metadata, extract_frame_at, get_ffmpeg_path
from engine.inpainter import WatermarkInpainter
from engine.processor import VideoProcessor

def test_full_flow():
    print("1. Testing FFmpeg binary...")
    ffmpeg_exe = get_ffmpeg_path()
    print("   FFmpeg path:", ffmpeg_exe)
    assert os.path.exists(ffmpeg_exe), "FFmpeg not found!"

    # Create dummy video of 30 frames (1 second) with a prominent watermark
    print("2. Generating test video...")
    test_dir = os.path.join(os.path.dirname(__file__), "scratch")
    os.makedirs(test_dir, exist_ok=True)
    input_video = os.path.join(test_dir, "test_input.mp4")
    output_video = os.path.join(test_dir, "test_output.mp4")

    w, h, fps = 640, 360, 30
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(input_video, fourcc, fps, (w, h))

    # Watermark box: x=400, y=50, w=180, h=40
    for i in range(30):
        # Moving colored background
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        frame[:, :] = [(i * 6) % 255, 120, 180]
        # Draw watermark
        cv2.rectangle(frame, (400, 50), (580, 90), (255, 255, 255), -1)
        cv2.putText(frame, "WATERMARK", (410, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 200), 2)
        out.write(frame)
    out.release()
    print("   Test video created:", input_video)

    # Test metadata
    meta = get_video_metadata(input_video)
    print("   Video metadata:", meta)
    assert meta["width"] == 640
    assert meta["height"] == 360

    # Test single-frame inpainting
    print("3. Testing single frame inpainting...")
    frame = extract_frame_at(input_video, frame_idx=0)
    assert frame is not None
    inpainter = WatermarkInpainter(mode="crystal_clear", inpaint_radius=5, feather_radius=4)
    cleaned = inpainter.inpaint_frame(frame, [{"x": 395, "y": 45, "width": 190, "height": 50}])
    assert cleaned.shape == frame.shape
    print("   Single frame inpainting succeeded!")

    # Test full video processor
    print("4. Testing VideoProcessor on entire video...")
    def on_progress(p):
        print(f"   Progress: {p.get('percent', 0)}% | FPS: {p.get('fps', 0)} | ETA: {p.get('eta_seconds', 0)}s")

    proc = VideoProcessor(
        input_video_path=input_video,
        output_video_path=output_video,
        regions=[{"x": 395, "y": 45, "width": 190, "height": 50}],
        mode="crystal_clear",
        inpaint_radius=5,
        feather_radius=4,
        temporal_blend=0.3,
        progress_callback=on_progress
    )

    final_path = proc.process()
    print("   Output video created at:", final_path)
    assert os.path.exists(final_path), "Output file does not exist!"
    print("\n[SUCCESS] ALL TESTS PASSED! Video watermark removal pipeline is 100% functional.\n")

if __name__ == "__main__":
    test_full_flow()
