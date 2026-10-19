/**
 * CrystalClear Video Watermark Remover - Main Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentVideoData = null; // { video_id, filename, metadata, ... }
    let selector = null;
    let isPlaying = false;
    let animFrameId = null;
    let activeTaskId = null;
    let statusPollInterval = null;

    // Elements
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
    // Initialization & Setup
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

    // Slider displays
    inpaintRadiusInput.addEventListener('input', (e) => {
        inpaintRadiusVal.textContent = `${e.target.value} px`;
    });
    featherRadiusInput.addEventListener('input', (e) => {
        featherRadiusVal.textContent = `${e.target.value} px`;
    });

    // -------------------------------------------------------------
    // Upload Handlers
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
            loadVideoIntoWorkspace(data);
        } catch (err) {
            alert(`Upload error: ${err.message}`);
        } finally {
            uploadSpinner.classList.add('hidden');
        }
    }

    async function loadSampleVideo() {
        uploadSpinner.classList.remove('hidden');
        try {
            const res = await fetch('/api/create_sample', { method: 'POST' });
            if (!res.ok) throw new Error('Failed to create sample video');
            const data = await res.json();
            loadVideoIntoWorkspace(data);

            // Pre-select the watermark area if suggested
            if (data.suggested_region) {
                setTimeout(() => {
                    selector.setBox(data.suggested_region);
                }, 300);
            }
        } catch (err) {
            alert(`Error loading sample: ${err.message}`);
        } finally {
            uploadSpinner.classList.add('hidden');
        }
    }

    // -------------------------------------------------------------
    // Workspace Setup
    // -------------------------------------------------------------
    function loadVideoIntoWorkspace(videoData) {
        currentVideoData = videoData;
        const meta = videoData.metadata;

        // Populate info bar
        videoFilename.textContent = videoData.filename;
        videoResolution.textContent = `${meta.width} × ${meta.height}`;
        videoDuration.textContent = formatTime(meta.duration);
        videoFps.textContent = `${meta.fps} fps`;
        videoSize.textContent = `${meta.file_size_mb} MB`;

        // Switch screen view
        uploadSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        editorSection.classList.remove('hidden');

        // Setup underlying video element
        sourceVideo.src = videoData.file_url;
        sourceVideo.load();

        sourceVideo.onloadedmetadata = () => {
            // Set canvas internal resolution to video's true native resolution
            editorCanvas.width = meta.width;
            editorCanvas.height = meta.height;

            timelineSlider.max = meta.duration;
            timelineSlider.value = 0;
            totalDurationDisplay.textContent = formatTime(meta.duration);
            currentTimeDisplay.textContent = '00:00';

            // Initial render
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

    btnClearBox.addEventListener('click', () => {
        selector.clearBox();
    });

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

    // Step frames back/forward (approx 1 frame = 1/fps seconds)
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
    // Instant Single-Frame Preview
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

        btnTestFramePreview.disabled = true;
        btnTestFramePreview.innerHTML = `
            <div class="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-2"></div>
            <span>Generating Preview...</span>
        `;

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

            if (!res.ok) throw new Error('Failed to generate preview');
            const data = await res.json();

            modalImgOriginal.src = data.original_preview;
            modalImgResult.src = data.inpainted_preview;
            previewModal.classList.remove('hidden');
        } catch (err) {
            alert(`Preview error: ${err.message}`);
        } finally {
            btnTestFramePreview.disabled = false;
            btnTestFramePreview.innerHTML = `
                <i data-lucide="eye" class="w-4 h-4 text-indigo-400"></i>
                <span>Preview Current Frame (Instant Test)</span>
            `;
            lucide.createIcons();
        }
    });

    btnClosePreviewModal.addEventListener('click', () => {
        previewModal.classList.add('hidden');
    });

    btnProceedFromPreview.addEventListener('click', () => {
        previewModal.classList.add('hidden');
        btnStartProcess.click();
    });

    // -------------------------------------------------------------
    // Full Video Watermark Removal Processing
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

        // Show progress HUD
        progressModal.classList.remove('hidden');
        progressBarFill.style.width = '0%';
        progressPercentText.textContent = '0.0%';
        statEta.textContent = 'Calculating...';
        statFps.textContent = '0.0 FPS';
        statFrames.textContent = `0 / ${currentVideoData.metadata.total_frames}`;

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

            if (!res.ok) throw new Error('Failed to start processing');
            const data = await res.json();
            activeTaskId = data.task_id;

            // Start polling status
            startStatusPolling(activeTaskId);
        } catch (err) {
            progressModal.classList.add('hidden');
            alert(`Processing failed to start: ${err.message}`);
        }
    });

    function startStatusPolling(taskId) {
        if (statusPollInterval) clearInterval(statusPollInterval);

        statusPollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/status/${taskId}`);
                if (!res.ok) return;

                const status = await res.json();

                // Update UI elements
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
                    progressThumbnail.src = `data:image/jpeg;base64,${status.thumbnail}`;
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
        if (!activeTaskId) return;
        if (confirm('Are you sure you want to cancel the watermark removal?')) {
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

        // Setup download button
        btnDownloadVideo.href = taskData.output_url;
        btnDownloadVideo.download = `crystal_clear_${currentVideoData.filename}`;

        // Setup split comparison videos
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
            if (isDraggingSplit) {
                updateSplit(e.clientX);
            }
        });

        window.addEventListener('mouseup', () => {
            isDraggingSplit = false;
        });

        // Touch support
        splitDividerLine.addEventListener('touchstart', (e) => {
            isDraggingSplit = true;
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
            if (isDraggingSplit && e.touches[0]) {
                updateSplit(e.touches[0].clientX);
            }
        });

        window.addEventListener('touchend', () => {
            isDraggingSplit = false;
        });
    }

    // Synchronized comparison playback
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

    // Helper: Format seconds to MM:SS
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Helper: Format ETA seconds
    function formatETA(secs) {
        if (secs < 60) return `~${secs}s remaining`;
        const mins = Math.floor(secs / 60);
        const remainSecs = secs % 60;
        return `~${mins}m ${remainSecs}s remaining`;
    }
});
