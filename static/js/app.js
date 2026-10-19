/**
 * CrystalClear Video Watermark Remover - Dual-Engine Application
 * Supports BOTH:
 * 1. 🌐 Browser-Only (Frontend) Mode: Runs 100% inside Chrome/Edge/Firefox using HTML5 Canvas & MediaRecorder (No server needed!)
 * 2. ⚡ Native Backend Mode: Ultra-fast multi-threaded OpenCV & FFmpeg C++ processing.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Engine State
    let engineMode = 'browser'; // 'browser' or 'backend'
    let isBackendAvailable = false;

    // Video & Project State
    let currentVideoData = null; // { video_id, filename, file_url, metadata, rawFile }
    let selector = null;
    let isPlaying = false;
    let animFrameId = null;

    // Active Processing State
    let activeTaskId = null;
    let statusPollInterval = null;
    let activeClientProcessor = null;

    // DOM Elements
    const btnToggleEngine = document.getElementById('btnToggleEngine');
    const enginePulseDot = document.getElementById('enginePulseDot');
    const engineStatusLabel = document.getElementById('engineStatusLabel');

    const uploadSection = document.getElementById('uploadSection');
    const editorSection = document.getElementById('editorSection');
    const resultSection = document.getElementById('resultSection');

    const dropZone = document.getElementById('dropZone');
    const videoFileInput = document.getElementById('videoFileInput');
    const uploadSpinner = document.getElementById('uploadSpinner');
    const btnTrySample = document.getElementById('btnTrySample');
    const btnTrySampleAlt = document.getElementById('btnTrySampleAlt');

    const videoFilename = document.getElementById('videoFilename');
    const videoResolution = document.getElementById('videoResolution');
    const videoDuration = document.getElementById('videoDuration');
    const videoFps = document.getElementById('videoFps');
    const videoSize = document.getElementById('videoSize');
    const btnChangeVideo = document.getElementById('btnChangeVideo');

    const sourceVideo = document.getElementById('sourceVideo');
    const editorCanvas = document.getElementById('editorCanvas');
    const selectionHint = document.getElementById('selectionHint');
    const boxCoordsPill = document.getElementById('boxCoordsPill');
    const boxCoordsText = document.getElementById('boxCoordsText');
    const btnClearBox = document.getElementById('btnClearBox');

    const timelineSlider = document.getElementById('timelineSlider');
    const currentTimeDisplay = document.getElementById('currentTimeDisplay');
    const totalDurationDisplay = document.getElementById('totalDurationDisplay');
    const btnPlayPause = document.getElementById('btnPlayPause');
    const playIcon = document.getElementById('playIcon');
    const playText = document.getElementById('playText');
    const btnPrevFrame = document.getElementById('btnPrevFrame');
    const btnNextFrame = document.getElementById('btnNextFrame');

    const inpaintRadiusInput = document.getElementById('inpaintRadiusInput');
    const inpaintRadiusVal = document.getElementById('inpaintRadiusVal');
    const featherRadiusInput = document.getElementById('featherRadiusInput');
    const featherRadiusVal = document.getElementById('featherRadiusVal');

    const btnTestFramePreview = document.getElementById('btnTestFramePreview');
    const previewModal = document.getElementById('previewModal');
    const btnClosePreviewModal = document.getElementById('btnClosePreviewModal');
    const btnProceedFromPreview = document.getElementById('btnProceedFromPreview');
    const modalImgOriginal = document.getElementById('modalImgOriginal');
    const modalImgResult = document.getElementById('modalImgResult');

    const btnStartProcess = document.getElementById('btnStartProcess');
    const progressModal = document.getElementById('progressModal');
    const progressStatusLabel = document.getElementById('progressStatusLabel');
    const progressThumbnail = document.getElementById('progressThumbnail');
    const progressPercentText = document.getElementById('progressPercentText');
    const progressBarFill = document.getElementById('progressBarFill');
    const statEta = document.getElementById('statEta');
    const statFps = document.getElementById('statFps');
    const statFrames = document.getElementById('statFrames');
    const btnCancelProcess = document.getElementById('btnCancelProcess');

    const resultMetaStats = document.getElementById('resultMetaStats');
    const btnDownloadVideo = document.getElementById('btnDownloadVideo');
    const btnProcessAnother = document.getElementById('btnProcessAnother');
    const resultVideoClean = document.getElementById('resultVideoClean');
    const resultVideoOrig = document.getElementById('resultVideoOrig');
    const splitOverlayClip = document.getElementById('splitOverlayClip');
    const splitDividerLine = document.getElementById('splitDividerLine');
    const splitViewerContainer = document.getElementById('splitViewerContainer');
    const btnPlayPauseComparison = document.getElementById('btnPlayPauseComparison');
    const compPlayIcon = document.getElementById('compPlayIcon');
    const compPlayText = document.getElementById('compPlayText');

    // -------------------------------------------------------------
    // Auto-Detect Engine (Frontend vs Backend)
    // -------------------------------------------------------------
    async function detectEngine() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1200);
            const res = await fetch('/api/tasks', { signal: controller.signal });
            clearTimeout(timeout);

            if (res.ok || res.status === 404 || res.status === 200) {
                isBackendAvailable = true;
                setEngineMode('backend');
                return;
            }
        } catch (e) {
            // Backend not running
        }
        isBackendAvailable = false;
        setEngineMode('browser');
    }

    function setEngineMode(mode) {
        engineMode = mode;
        if (mode === 'backend') {
            enginePulseDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-2';
            btnToggleEngine.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition cursor-pointer';
            engineStatusLabel.textContent = '⚡ Native Backend (FFmpeg + OpenCV)';
        } else {
            enginePulseDot.className = 'w-2 h-2 rounded-full bg-cyan-400 mr-2';
            btnToggleEngine.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition cursor-pointer';
            engineStatusLabel.textContent = '🌐 Frontend-Only Mode (Offline / In-Browser)';
        }
    }

    btnToggleEngine.addEventListener('click', () => {
        if (!isBackendAvailable && engineMode === 'browser') {
            alert('Backend server is not running right now. The application is running 100% in Browser-Only (Frontend) mode without needing any server!');
            return;
        }
        const newMode = engineMode === 'backend' ? 'browser' : 'backend';
        setEngineMode(newMode);
    });

    detectEngine();

    // -------------------------------------------------------------
    // Setup Canvas Selector
    // -------------------------------------------------------------
    selector = new CanvasSelector(editorCanvas, sourceVideo, (box) => {
        if (box && box.width > 2 && box.height > 2) {
            selectionHint.style.opacity = '0';
            boxCoordsPill.classList.remove('hidden');
            boxCoordsPill.classList.add('flex');
            boxCoordsText.textContent = `X: ${box.x}, Y: ${box.y} | ${box.width} × ${box.height}`;
        } else {
            selectionHint.style.opacity = '1';
            boxCoordsPill.classList.add('hidden');
            boxCoordsPill.classList.remove('flex');
        }
    });

    inpaintRadiusInput.addEventListener('input', (e) => {
        inpaintRadiusVal.textContent = `${e.target.value} px`;
    });
    featherRadiusInput.addEventListener('input', (e) => {
        featherRadiusVal.textContent = `${e.target.value} px`;
    });

    // -------------------------------------------------------------
    // Upload Handlers (Supports Drag & Drop, File Picker, Sample)
    // -------------------------------------------------------------
    dropZone.addEventListener('click', () => videoFileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-indigo-500', 'bg-indigo-500/10');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-indigo-500', 'bg-indigo-500/10');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-indigo-500', 'bg-indigo-500/10');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });

    videoFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
        }
    });

    btnTrySample.addEventListener('click', () => loadSampleVideo());
    btnTrySampleAlt.addEventListener('click', () => loadSampleVideo());

    async function handleFileUpload(file) {
        uploadSpinner.classList.remove('hidden');

        if (engineMode === 'backend') {
            // Backend Upload
            const formData = new FormData();
            formData.append('file', file);

            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || 'Upload failed');
                }

                const data = await res.json();
                data.rawFile = file;
                loadVideoIntoWorkspace(data);
            } catch (err) {
                console.warn('Backend upload failed, falling back to Browser-Only mode:', err);
                setEngineMode('browser');
                loadVideoClientSide(file);
            } finally {
                uploadSpinner.classList.add('hidden');
            }
        } else {
            // Frontend-Only Mode: Load video directly in browser with 0 upload delay!
            loadVideoClientSide(file);
            uploadSpinner.classList.add('hidden');
        }
    }

    function loadVideoClientSide(file) {
        const fileUrl = URL.createObjectURL(file);
        const tempVideo = document.createElement('video');
        tempVideo.src = fileUrl;
        tempVideo.preload = 'metadata';

        tempVideo.onloadedmetadata = () => {
            const width = tempVideo.videoWidth || 1280;
            const height = tempVideo.videoHeight || 720;
            const duration = tempVideo.duration || 10;
            const sizeMB = Math.round((file.size / (1024 * 1024)) * 10) / 10;

            const videoData = {
                video_id: 'client_' + Date.now(),
                filename: file.name,
                file_url: fileUrl,
                rawFile: file,
                metadata: {
                    width: width,
                    height: height,
                    duration: duration,
                    fps: 30,
                    file_size_mb: sizeMB
                }
            };
            loadVideoIntoWorkspace(videoData);
        };
    }

    async function loadSampleVideo() {
        uploadSpinner.classList.remove('hidden');

        if (engineMode === 'backend') {
            try {
                const res = await fetch('/api/create_sample', { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    loadVideoIntoWorkspace(data);
                    if (data.suggested_region) {
                        setTimeout(() => selector.setBox(data.suggested_region), 300);
                    }
                    uploadSpinner.classList.add('hidden');
                    return;
                }
            } catch (e) {
                // Fallback to client sample
            }
        }

        // Client-side generated sample video
        generateClientSampleVideo().then((sampleData) => {
            loadVideoIntoWorkspace(sampleData);
            setTimeout(() => {
                selector.setBox(sampleData.suggested_region);
            }, 300);
            uploadSpinner.classList.add('hidden');
        });
    }

    /**
     * Generates a 4-second animated video with a watermark inside the browser.
     */
    function generateClientSampleVideo() {
        return new Promise((resolve) => {
            const w = 1280, h = 720, fps = 30, dur = 4;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');

            const stream = canvas.captureStream(fps);
            const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            const chunks = [];
            recorder.ondataavailable = e => chunks.push(e.data);
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                resolve({
                    video_id: 'sample_browser',
                    filename: 'Sample_Demo_Video.webm',
                    file_url: url,
                    metadata: { width: w, height: h, duration: dur, fps: fps, file_size_mb: 1.2 },
                    suggested_region: { x: 920, y: 60, width: 300, height: 70 }
                });
            };

            recorder.start();
            let frame = 0;
            const total = fps * dur;

            const interval = setInterval(() => {
                if (frame >= total) {
                    clearInterval(interval);
                    recorder.stop();
                    return;
                }
                const t = frame / total;

                // Animated background
                const grad = ctx.createLinearGradient(0, 0, w, h);
                grad.addColorStop(0, `hsl(${t * 360}, 65%, 45%)`);
                grad.addColorStop(1, `hsl(${(t * 360 + 60) % 360}, 75%, 25%)`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, w, h);

                // Moving orb
                const ox = 400 + Math.sin(t * Math.PI * 2) * 250;
                const oy = 350 + Math.cos(t * Math.PI * 2) * 100;
                ctx.fillStyle = '#fef08a';
                ctx.beginPath();
                ctx.arc(ox, oy, 70, 0, Math.PI * 2);
                ctx.fill();

                // Watermark box in top right
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.fillRect(920, 60, 300, 70);
                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = 3;
                ctx.strokeRect(920, 60, 300, 70);
                ctx.fillStyle = '#991b1b';
                ctx.font = 'bold 24px sans-serif';
                ctx.fillText('WATERMARK PRO', 950, 105);

                frame++;
            }, 1000 / fps);
        });
    }

    // -------------------------------------------------------------
    // Workspace Setup
    // -------------------------------------------------------------
    function loadVideoIntoWorkspace(videoData) {
        currentVideoData = videoData;
        const meta = videoData.metadata;

        videoFilename.textContent = videoData.filename;
        videoResolution.textContent = `${meta.width} × ${meta.height}`;
        videoDuration.textContent = formatTime(meta.duration);
        videoFps.textContent = `${meta.fps} fps`;
        videoSize.textContent = `${meta.file_size_mb} MB`;

        uploadSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        editorSection.classList.remove('hidden');

        sourceVideo.src = videoData.file_url;
        sourceVideo.load();

        sourceVideo.onloadedmetadata = () => {
            editorCanvas.width = meta.width;
            editorCanvas.height = meta.height;
            timelineSlider.max = meta.duration;
            timelineSlider.value = 0;
            totalDurationDisplay.textContent = formatTime(meta.duration);
            currentTimeDisplay.textContent = '00:00';
            sourceVideo.currentTime = 0;
        };

        sourceVideo.onseeked = () => {
            selector.render();
        };

        sourceVideo.onplay = () => {
            isPlaying = true;
            playIcon.setAttribute('data-lucide', 'pause');
            playText.textContent = 'Pause';
            lucide.createIcons();
            startPlaybackLoop();
        };

        sourceVideo.onpause = () => {
            isPlaying = false;
            playIcon.setAttribute('data-lucide', 'play');
            playText.textContent = 'Play';
            lucide.createIcons();
            cancelAnimationFrame(animFrameId);
            selector.render();
        };
    }

    btnChangeVideo.addEventListener('click', () => {
        if (sourceVideo) sourceVideo.pause();
        editorSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        uploadSection.classList.remove('hidden');
        selector.clearBox();
    });

    btnClearBox.addEventListener('click', () => selector.clearBox());

    // -------------------------------------------------------------
    // Video Controls & Timeline
    // -------------------------------------------------------------
    function startPlaybackLoop() {
        function loop() {
            if (!isPlaying) return;
            timelineSlider.value = sourceVideo.currentTime;
            currentTimeDisplay.textContent = formatTime(sourceVideo.currentTime);
            selector.render();
            animFrameId = requestAnimationFrame(loop);
        }
        animFrameId = requestAnimationFrame(loop);
    }

    btnPlayPause.addEventListener('click', () => {
        if (!sourceVideo.src) return;
        if (sourceVideo.paused) {
            sourceVideo.play();
        } else {
            sourceVideo.pause();
        }
    });

    timelineSlider.addEventListener('input', (e) => {
        const time = parseFloat(e.target.value);
        sourceVideo.currentTime = time;
        currentTimeDisplay.textContent = formatTime(time);
        selector.render();
    });

    btnPrevFrame.addEventListener('click', () => {
        if (!currentVideoData) return;
        sourceVideo.pause();
        const step = 1.0 / (currentVideoData.metadata.fps || 30);
        sourceVideo.currentTime = Math.max(0, sourceVideo.currentTime - step);
    });

    btnNextFrame.addEventListener('click', () => {
        if (!currentVideoData) return;
        sourceVideo.pause();
        const step = 1.0 / (currentVideoData.metadata.fps || 30);
        sourceVideo.currentTime = Math.min(currentVideoData.metadata.duration, sourceVideo.currentTime + step);
    });

    // -------------------------------------------------------------
    // Instant Single-Frame Preview (Works in BOTH Backend & Browser)
    // -------------------------------------------------------------
    btnTestFramePreview.addEventListener('click', async () => {
        const box = selector.getBox();
        if (!box) {
            alert('Please select the watermark area on the video first!');
            return;
        }

        const mode = document.querySelector('input[name="inpaintMode"]:checked').value;
        const inpaintRadius = parseInt(inpaintRadiusInput.value);
        const featherRadius = parseInt(featherRadiusInput.value);

        if (engineMode === 'backend') {
            btnTestFramePreview.disabled = true;
            try {
                const res = await fetch('/api/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        video_id: currentVideoData.video_id,
                        timestamp: sourceVideo.currentTime,
                        regions: [box],
                        mode: mode,
                        inpaint_radius: inpaintRadius,
                        feather_radius: featherRadius
                    })
                });
                if (!res.ok) throw new Error('Preview failed');
                const data = await res.json();
                modalImgOriginal.src = data.original_preview;
                modalImgResult.src = data.inpainted_preview;
                previewModal.classList.remove('hidden');
            } catch (err) {
                // Fallback to client inpainter
                renderClientPreview(box, mode, inpaintRadius, featherRadius);
            } finally {
                btnTestFramePreview.disabled = false;
            }
        } else {
            // Frontend-Only instant preview in < 5ms
            renderClientPreview(box, mode, inpaintRadius, featherRadius);
        }
    });

    function renderClientPreview(box, mode, inpaintRadius, featherRadius) {
        const w = editorCanvas.width;
        const h = editorCanvas.height;

        // Original frame snapshot
        const origCanvas = document.createElement('canvas');
        origCanvas.width = w; origCanvas.height = h;
        const oCtx = origCanvas.getContext('2d');
        oCtx.drawImage(sourceVideo, 0, 0, w, h);
        modalImgOriginal.src = origCanvas.toDataURL('image/jpeg', 0.9);

        // Inpainted frame snapshot
        const inpaintCanvas = document.createElement('canvas');
        inpaintCanvas.width = w; inpaintCanvas.height = h;
        const iCtx = inpaintCanvas.getContext('2d');
        iCtx.drawImage(sourceVideo, 0, 0, w, h);

        const inpainter = new ClientInpainter({ mode, inpaintRadius, featherRadius });
        inpainter.inpaintCanvas(iCtx, box);
        modalImgResult.src = inpaintCanvas.toDataURL('image/jpeg', 0.9);

        previewModal.classList.remove('hidden');
    }

    btnClosePreviewModal.addEventListener('click', () => previewModal.classList.add('hidden'));
    btnProceedFromPreview.addEventListener('click', () => {
        previewModal.classList.add('hidden');
        btnStartProcess.click();
    });

    // -------------------------------------------------------------
    // Full Video Watermark Removal (Backend OR Browser Engine)
    // -------------------------------------------------------------
    btnStartProcess.addEventListener('click', async () => {
        const box = selector.getBox();
        if (!box) {
            alert('Please select the watermark area on the video by clicking and dragging on the player!');
            return;
        }

        sourceVideo.pause();

        const mode = document.querySelector('input[name="inpaintMode"]:checked').value;
        const inpaintRadius = parseInt(inpaintRadiusInput.value);
        const featherRadius = parseInt(featherRadiusInput.value);

        progressModal.classList.remove('hidden');
        progressBarFill.style.width = '0%';
        progressPercentText.textContent = '0.0%';
        statEta.textContent = 'Calculating...';
        statFps.textContent = '0.0 FPS';
        statFrames.textContent = `0 / ${currentVideoData.metadata.total_frames || 100}`;

        if (engineMode === 'backend') {
            // Native Backend Processing
            progressStatusLabel.textContent = 'Rendering with native FFmpeg + OpenCV';
            try {
                const res = await fetch('/api/process', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        video_id: currentVideoData.video_id,
                        regions: [box],
                        mode: mode,
                        inpaint_radius: inpaintRadius,
                        feather_radius: featherRadius,
                        temporal_blend: 0.3
                    })
                });

                if (!res.ok) throw new Error('Processing initiation failed');
                const data = await res.json();
                activeTaskId = data.task_id;
                startStatusPolling(activeTaskId);
            } catch (err) {
                console.warn('Backend processing failed, falling back to browser processor:', err);
                startClientSideProcessing(box, mode, inpaintRadius, featherRadius);
            }
        } else {
            // Frontend-Only Processing right in the browser!
            startClientSideProcessing(box, mode, inpaintRadius, featherRadius);
        }
    });

    function startClientSideProcessing(box, mode, inpaintRadius, featherRadius) {
        progressStatusLabel.textContent = 'Processing frame-by-frame inside your browser (100% private)';

        activeClientProcessor = new ClientVideoProcessor(sourceVideo, box, {
            mode: mode,
            inpaintRadius: inpaintRadius,
            featherRadius: featherRadius,
            fps: currentVideoData.metadata.fps || 30,
            onProgress: (status) => {
                const pct = status.percent || 0;
                progressBarFill.style.width = `${pct}%`;
                progressPercentText.textContent = `${pct.toFixed(1)}%`;
                statFps.textContent = `${status.fps || 0} FPS`;
                statFrames.textContent = `${status.current_frame || 0} / ${status.total_frames || 0}`;

                if (status.eta_seconds !== undefined && status.eta_seconds > 0) {
                    statEta.textContent = formatETA(status.eta_seconds);
                } else if (pct > 0) {
                    statEta.textContent = 'Almost done...';
                }

                if (status.thumbnail) {
                    progressThumbnail.src = status.thumbnail;
                }
            },
            onComplete: (status) => {
                progressModal.classList.add('hidden');
                showCompletedResult({
                    output_url: status.output_url,
                    stream_url: status.stream_url,
                    elapsed_seconds: status.elapsed_seconds,
                    fps: status.fps
                });
            },
            onError: (err) => {
                progressModal.classList.add('hidden');
                if (err.message && !err.message.includes('cancelled')) {
                    alert(`Browser processing error: ${err.message}`);
                }
            }
        });

        activeClientProcessor.start().catch(() => {});
    }

    function startStatusPolling(taskId) {
        if (statusPollInterval) clearInterval(statusPollInterval);

        statusPollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/status/${taskId}`);
                if (!res.ok) return;

                const status = await res.json();
                const pct = status.percent || 0;
                progressBarFill.style.width = `${pct}%`;
                progressPercentText.textContent = `${pct.toFixed(1)}%`;
                statFps.textContent = `${status.fps || 0} FPS`;
                statFrames.textContent = `${status.current_frame || 0} / ${status.total_frames || 0}`;

                if (status.eta_seconds !== undefined && status.eta_seconds > 0) {
                    statEta.textContent = formatETA(status.eta_seconds);
                } else if (pct > 0) {
                    statEta.textContent = 'Almost done...';
                }

                if (status.thumbnail) {
                    progressThumbnail.src = `data:image/jpeg;base64,{status.thumbnail}`;
                }

                if (status.status === 'completed') {
                    clearInterval(statusPollInterval);
                    progressModal.classList.add('hidden');
                    showCompletedResult(status);
                } else if (status.status === 'failed') {
                    clearInterval(statusPollInterval);
                    progressModal.classList.add('hidden');
                    alert(`Processing failed: ${status.error || 'Unknown error'}`);
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 400);
    }

    btnCancelProcess.addEventListener('click', async () => {
        if (activeClientProcessor) {
            activeClientProcessor.cancel();
            activeClientProcessor = null;
            progressModal.classList.add('hidden');
            return;
        }

        if (activeTaskId && confirm('Are you sure you want to cancel the watermark removal?')) {
            try {
                await fetch(`/api/cancel/${activeTaskId}`, { method: 'POST' });
                clearInterval(statusPollInterval);
                progressModal.classList.add('hidden');
            } catch (err) {
                console.error(err);
            }
        }
    });

    // -------------------------------------------------------------
    // Result Screen & Interactive Comparison Split Viewer
    // -------------------------------------------------------------
    function showCompletedResult(taskData) {
        editorSection.classList.add('hidden');
        resultSection.classList.remove('hidden');

        resultMetaStats.textContent = `Completed in ${taskData.elapsed_seconds}s at ${taskData.fps} FPS • Lossless audio preserved`;

        btnDownloadVideo.href = taskData.output_url;
        btnDownloadVideo.download = `crystal_clear_${currentVideoData.filename}`;

        resultVideoClean.src = taskData.stream_url;
        resultVideoOrig.src = currentVideoData.file_url;

        resultVideoClean.load();
        resultVideoOrig.load();

        initSplitDivider();
    }

    btnProcessAnother.addEventListener('click', () => {
        resultVideoClean.pause();
        resultVideoOrig.pause();
        resultSection.classList.add('hidden');
        editorSection.classList.remove('hidden');
    });

    function initSplitDivider() {
        let isDraggingSplit = false;

        const updateSplit = (clientX) => {
            const rect = splitViewerContainer.getBoundingClientRect();
            let pct = ((clientX - rect.left) / rect.width) * 100;
            pct = Math.max(0, Math.min(100, pct));

            splitOverlayClip.style.width = `${pct}%`;
            splitDividerLine.style.left = `${pct}%`;
        };

        splitDividerLine.addEventListener('mousedown', (e) => {
            isDraggingSplit = true;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (isDraggingSplit) updateSplit(e.clientX);
        });

        window.addEventListener('mouseup', () => { isDraggingSplit = false; });

        splitDividerLine.addEventListener('touchstart', () => { isDraggingSplit = true; }, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (isDraggingSplit && e.touches[0]) updateSplit(e.touches[0].clientX);
        });
        window.addEventListener('touchend', () => { isDraggingSplit = false; });
    }

    let isCompPlaying = false;
    btnPlayPauseComparison.addEventListener('click', () => {
        if (isCompPlaying) {
            resultVideoClean.pause();
            resultVideoOrig.pause();
            isCompPlaying = false;
            compPlayIcon.setAttribute('data-lucide', 'play');
            compPlayText.textContent = 'Play Synchronized Preview';
        } else {
            resultVideoClean.currentTime = 0;
            resultVideoOrig.currentTime = 0;
            resultVideoClean.play();
            resultVideoOrig.play();
            isCompPlaying = true;
            compPlayIcon.setAttribute('data-lucide', 'pause');
            compPlayText.textContent = 'Pause Synchronized Preview';
        }
        lucide.createIcons();
    });

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function formatETA(secs) {
        if (secs < 60) return `~${secs}s remaining`;
        const mins = Math.floor(secs / 60);
        const remainSecs = secs % 60;
        return `~${mins}m ${remainSecs}s remaining`;
    }
});
