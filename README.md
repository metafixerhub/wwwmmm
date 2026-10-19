# ✨ CrystalClear - AI Video Watermark Remover

A modern, user-friendly desktop web application designed to cleanly remove watermarks, logos, timestamps, and subtitles from videos with **crystal-clear quality**, seamless boundary blending, and zero audio loss.

---

## 🚀 Quick Start (1-Click Launch)

### On Windows:
Simply **double-click** the batch launcher in this folder:
```
start_app.bat
```
*Or from terminal / command prompt:*
```bash
python run.py
```
The app will automatically locate a free port (e.g. `http://127.0.0.1:8000`), launch the backend, and open your web browser automatically!

---

## 🌟 Key Features & Workflow

1. **User-Comfortable Modern UI**:
   - Clean dark-mode glassmorphic interface built with Tailwind CSS & Lucide icons.
   - Large drag-and-drop video upload zone (supports MP4, MOV, MKV, WebM, AVI up to 4K).
   - **1-Click Demo Sample Video**: Includes a built-in animated video with watermark so you can test the application instantly with zero preparation.

2. **Interactive Video Canvas & Bounding Box Selector**:
   - Click and drag directly on the video player to select the watermark.
   - **8-Handle Resizing**: Easily resize the box from any corner or edge (NW, N, NE, E, SE, S, SW, W).
   - **Repositioning**: Grab and move the box anywhere across the frame.
   - Precise pixel coordinate indicator (`X, Y | Width × Height`).
   - Video scrubber with frame stepping (`⏮️ Step Back`, `⏭️ Step Forward`) and play/pause controls.

3. **Crystal-Clear Inpainting Engine**:
   - **🌟 Crystal Clear Hybrid**: Multi-scale Navier-Stokes fluid dynamics and Telea fast-marching with gradient texture synthesis.
   - **Edge Feathering (No Seams)**: Soft Gaussian boundary alpha mask prevents rectangular borders and seam artifacts.
   - **Temporal Smoothing**: Eliminates inter-frame flickering for smooth motion.
   - **⚡ Fast Delogo**: High-speed edge interpolation (100+ FPS).
   - **🌫️ Feathered Blur**: Soft gradient blur for privacy or censoring needs.

4. **Instant Single-Frame Preview ("Test on Current Frame")**:
   - Before committing to processing an entire video, click **"Preview Current Frame"**.
   - See the exact before-and-after result on your current frame in **< 0.2 seconds** to verify quality.

5. **Real-Time Progress & Accurate ETA Estimation**:
   - Live progress bar (0% to 100%).
   - Frame counter (`Frame 150 / 450`).
   - Processing speed in FPS.
   - Dynamic **Estimated Time Remaining (ETA)** countdown (`~12s remaining`).
   - Live thumbnail feed showing the frames being cleaned in real-time.
   - Abort / Cancel button to stop anytime.

6. **Interactive Split-Screen Comparison & Lossless Export**:
   - **Interactive Split Slider**: Drag the vertical divider left/right to compare the original watermarked video with the cleaned video in synchronized playback.
   - **Lossless Audio Preservation**: The original audio track is losslessly remuxed without re-compression.
   - One-click **Download Crystal-Clear Video** button.

---

## 🛠️ Architecture

- **Backend**: FastAPI + Python 3.14 + Uvicorn
- **Computer Vision**: OpenCV 5 (`cv2.inpaint`, `cv2.GaussianBlur`, `cv2.VideoCapture`)
- **Video & Audio Pipeline**: FFmpeg v7.1 via `imageio-ffmpeg` subprocess pipes (direct rawvideo streaming into high-quality H.264 MP4)
- **Frontend**: Responsive HTML5, Canvas 2D API, Tailwind CSS, Lucide Icons

---

## 📁 Project Structure

```
watermark remover/
├── start_app.bat          # 1-Click Windows desktop launcher
├── run.py                 # Python launcher with auto-port & browser open
├── app.py                 # FastAPI backend application
├── requirements.txt       # Python dependencies
├── test_pipeline.py       # End-to-end verification test suite
├── engine/
│   ├── __init__.py
│   ├── inpainter.py       # Inpainting engine with feathered blending
│   ├── processor.py       # Full-video frame processor with progress & ETA
│   └── video_utils.py     # Metadata extraction, frame capture, audio remuxing
└── static/
    ├── index.html         # User-comfortable Single Page Application
    ├── css/
    │   └── style.css      # Custom styling & animations
    └── js/
        ├── app.js         # UI logic, uploads, progress polling, comparison
        └── canvas_selector.js # Interactive canvas bounding box selector
```
