/**
 * ClientVideoProcessor - Full Video Inpainting Pipeline inside the Browser
 * Features:
 * 1. 🚀 Ultra Speed Mode: Continuous GPU-accelerated forward decode (requestVideoFrameCallback) running at 30-60 FPS with zero seek lag.
 * 2. ⚡ Mobile Resolution Optimization: Scales to 720p/1080p to prevent mobile GPU throttling on 4K files.
 * 3. 📲 Universal Mobile Download & Gallery Save: Native Web Share API + AndroidBridge + direct Blob download.
 * 4. 🎯 Precision Mode: Optional step-by-step frame seeking.
 */
class ClientVideoProcessor {
    constructor(videoElement, box, options = {}) {
        this.video = videoElement;
        this.box = box;
        this.options = options;
        this.inpainter = new ClientInpainter(options);
        this.isCancelled = false;
        this.onProgress = options.onProgress || null;
        this.onComplete = options.onComplete || null;
        this.onError = options.onError || null;

        // Speed preset: 'ultra' (real-time GPU forward decode, default) or 'precision'
        this.engineSpeed = options.engineSpeed || 'ultra';
        // Max resolution preset: '720p', '1080p', or 'native'
        this.resolutionPreset = options.resolutionPreset || '720p';

        // Processing canvas
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    }

    cancel() {
        this.isCancelled = true;
        if (this.video && !this.video.paused) {
            this.video.pause();
        }
    }

    async start() {
        const video = this.video;
        const origBox = this.box;

        const origW = video.videoWidth || 1280;
        const origH = video.videoHeight || 720;
        const duration = video.duration || 5;
        const fps = this.options.fps || 30;

        // Calculate optimal resolution
        let targetW = origW;
        let targetH = origH;

        if (this.resolutionPreset === '720p' && origH > 720) {
            const scale = 720 / origH;
            targetH = 720;
            targetW = Math.round((origW * scale) / 2) * 2; // ensure even dimensions
        } else if (this.resolutionPreset === '1080p' && origH > 1080) {
            const scale = 1080 / origH;
            targetH = 1080;
            targetW = Math.round((origW * scale) / 2) * 2;
        }

        this.canvas.width = targetW;
        this.canvas.height = targetH;

        // Scale bounding box to match target processing resolution
        const scaleX = targetW / origW;
        const scaleY = targetH / origH;
        const scaledBox = {
            x: Math.round(origBox.x * scaleX),
            y: Math.round(origBox.y * scaleY),
            width: Math.round(origBox.width * scaleX),
            height: Math.round(origBox.height * scaleY)
        };

        // Check supported MediaRecorder formats
        const mimeTypes = [
            'video/mp4;codecs=avc1,mp4a.40.2',
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ];
        let selectedMime = 'video/webm';
        for (const mime of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mime)) {
                selectedMime = mime;
                break;
            }
        }

        // Setup audio stream from source video
        let audioTracks = [];
        try {
            const stream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
            if (stream) {
                audioTracks = stream.getAudioTracks();
            }
        } catch (e) {
            console.warn('Could not extract audio track:', e);
        }

        // Capture stream from processing canvas
        const canvasStream = this.canvas.captureStream(fps);
        const combinedStream = new MediaStream([
            canvasStream.getVideoTracks()[0],
            ...audioTracks
        ]);

        const recordedChunks = [];
        let mediaRecorder;
        const bitrate = targetH <= 720 ? 4500000 : 8000000;
        try {
            mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: selectedMime,
                videoBitsPerSecond: bitrate
            });
        } catch (err) {
            mediaRecorder = new MediaRecorder(combinedStream);
        }

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        const recordingCompletePromise = new Promise((resolve) => {
            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: selectedMime });
                const blobUrl = URL.createObjectURL(blob);
                resolve({ blobUrl, blob, mime: selectedMime });
            };
        });

        // Choose between Ultra Speed Continuous GPU Decode vs Precision Stepper
        if (this.engineSpeed === 'ultra') {
            return await this.runUltraSpeedPipeline(video, scaledBox, targetW, targetH, duration, mediaRecorder, recordingCompletePromise);
        } else {
            return await this.runPrecisionStepPipeline(video, scaledBox, targetW, targetH, duration, fps, mediaRecorder, recordingCompletePromise);
        }
    }

    /**
     * 🚀 Ultra Speed Mode: Zero-seeking forward GPU decode pipeline.
     * Processes video as it decodes in hardware at 30 to 60+ FPS.
     */
    async runUltraSpeedPipeline(video, scaledBox, targetW, targetH, duration, mediaRecorder, recordingCompletePromise) {
        // Reset video to beginning
        video.pause();
        await this.seekVideoTo(video, 0);

        mediaRecorder.start();
        const startTime = performance.now();
        let frameCount = 0;

        try {
            video.muted = true; // Avoid feedback during accelerated processing
            video.playbackRate = 1.0;
            await video.play();

            if ('requestVideoFrameCallback' in video) {
                // Modern hardware compositor callback
                await new Promise((resolve, reject) => {
                    const onFrame = (now, metadata) => {
                        if (this.isCancelled) {
                            video.pause();
                            mediaRecorder.stop();
                            reject(new Error('Processing cancelled by user.'));
                            return;
                        }

                        // Draw and inpaint
                        this.ctx.drawImage(video, 0, 0, targetW, targetH);
                        this.inpainter.inpaintCanvas(this.ctx, scaledBox);
                        frameCount++;

                        const curTime = video.currentTime;
                        const percent = Math.min(100, (curTime / (duration || 0.001)) * 100);
                        const elapsedSec = (performance.now() - startTime) / 1000;
                        const currentFps = frameCount / (elapsedSec || 0.001);
                        const remainSec = Math.max(0, duration - curTime);
                        const etaSeconds = Math.round(remainSec);

                        let thumbData = null;
                        if (frameCount % 15 === 1 || curTime >= duration - 0.2) {
                            thumbData = this.canvas.toDataURL('image/jpeg', 0.65);
                        }

                        if (this.onProgress) {
                            this.onProgress({
                                status: 'processing',
                                current_frame: frameCount,
                                total_frames: Math.round(duration * 30),
                                percent: percent,
                                fps: Math.round(currentFps * 10) / 10,
                                elapsed_seconds: Math.round(elapsedSec * 10) / 10,
                                eta_seconds: etaSeconds,
                                thumbnail: thumbData
                            });
                        }

                        if (!video.ended && !video.paused && curTime < duration - 0.05) {
                            video.requestVideoFrameCallback(onFrame);
                        } else {
                            resolve();
                        }
                    };

                    video.onended = () => resolve();
                    video.requestVideoFrameCallback(onFrame);
                });
            } else {
                // requestAnimationFrame fallback for older browsers
                await new Promise((resolve, reject) => {
                    const onAnim = () => {
                        if (this.isCancelled) {
                            video.pause();
                            mediaRecorder.stop();
                            reject(new Error('Processing cancelled by user.'));
                            return;
                        }

                        this.ctx.drawImage(video, 0, 0, targetW, targetH);
                        this.inpainter.inpaintCanvas(this.ctx, scaledBox);
                        frameCount++;

                        const curTime = video.currentTime;
                        const percent = Math.min(100, (curTime / (duration || 0.001)) * 100);
                        const elapsedSec = (performance.now() - startTime) / 1000;
                        const currentFps = frameCount / (elapsedSec || 0.001);

                        if (this.onProgress) {
                            this.onProgress({
                                status: 'processing',
                                current_frame: frameCount,
                                total_frames: Math.round(duration * 30),
                                percent: percent,
                                fps: Math.round(currentFps * 10) / 10,
                                elapsed_seconds: Math.round(elapsedSec * 10) / 10,
                                eta_seconds: Math.round(Math.max(0, duration - curTime))
                            });
                        }

                        if (!video.ended && !video.paused && curTime < duration - 0.05) {
                            requestAnimationFrame(onAnim);
                        } else {
                            resolve();
                        }
                    };
                    video.onended = () => resolve();
                    requestAnimationFrame(onAnim);
                });
            }

            video.pause();
            mediaRecorder.stop();

            const result = await recordingCompletePromise;
            const totalElapsed = (performance.now() - startTime) / 1000;

            if (this.onComplete) {
                this.onComplete({
                    status: 'completed',
                    output_url: result.blobUrl,
                    stream_url: result.blobUrl,
                    elapsed_seconds: Math.round(totalElapsed * 10) / 10,
                    fps: Math.round((frameCount / (totalElapsed || 0.001)) * 10) / 10,
                    blob: result.blob,
                    mime: result.mime
                });
            }

            return result;
        } catch (err) {
            video.pause();
            if (this.onError) this.onError(err);
            throw err;
        }
    }

    /**
     * Precision Stepper Pipeline (Frame-by-frame seeking)
     */
    async runPrecisionStepPipeline(video, scaledBox, targetW, targetH, duration, fps, mediaRecorder, recordingCompletePromise) {
        const totalFrames = Math.max(1, Math.round(duration * fps));
        const frameInterval = 1.0 / fps;
        mediaRecorder.start();

        const startTime = performance.now();
        let frameCount = 0;

        try {
            for (let f = 0; f < totalFrames; f++) {
                if (this.isCancelled) {
                    mediaRecorder.stop();
                    throw new Error('Processing cancelled by user.');
                }

                const targetTime = Math.min(duration, f * frameInterval);
                await this.seekVideoTo(video, targetTime);

                this.ctx.drawImage(video, 0, 0, targetW, targetH);
                this.inpainter.inpaintCanvas(this.ctx, scaledBox);

                frameCount++;
                const now = performance.now();
                const elapsedSec = (now - startTime) / 1000;
                const currentFps = frameCount / (elapsedSec || 0.001);
                const percent = Math.min(100, (frameCount / totalFrames) * 100);
                const remainingFrames = Math.max(0, totalFrames - frameCount);
                const etaSeconds = currentFps > 0 ? Math.round(remainingFrames / currentFps) : 0;

                let thumbData = null;
                if (frameCount % 15 === 1 || frameCount === totalFrames) {
                    thumbData = this.canvas.toDataURL('image/jpeg', 0.65);
                }

                if (this.onProgress) {
                    this.onProgress({
                        status: 'processing',
                        current_frame: frameCount,
                        total_frames: totalFrames,
                        percent: percent,
                        fps: Math.round(currentFps * 10) / 10,
                        elapsed_seconds: Math.round(elapsedSec * 10) / 10,
                        eta_seconds: etaSeconds,
                        thumbnail: thumbData
                    });
                }

                await new Promise(r => setTimeout(r, 0));
            }

            mediaRecorder.stop();
            const result = await recordingCompletePromise;
            const totalElapsed = (performance.now() - startTime) / 1000;

            if (this.onComplete) {
                this.onComplete({
                    status: 'completed',
                    output_url: result.blobUrl,
                    stream_url: result.blobUrl,
                    elapsed_seconds: Math.round(totalElapsed * 10) / 10,
                    fps: Math.round((totalFrames / totalElapsed) * 10) / 10,
                    blob: result.blob,
                    mime: result.mime
                });
            }

            return result;
        } catch (err) {
            if (this.onError) this.onError(err);
            throw err;
        }
    }

    seekVideoTo(video, time) {
        return new Promise((resolve) => {
            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                resolve();
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = time;
        });
    }

    /**
     * Universal Mobile & Desktop Video Downloader & Gallery Saver.
     */
    static async saveOrDownload(blob, originalFilename) {
        const isWebM = blob.type.includes('webm');
        const ext = isWebM ? '.webm' : '.mp4';
        const cleanName = (originalFilename || 'video').replace(/\.[^/.]+$/, '') + '_cleaned' + ext;

        // 1. Check Native Android Bridge inside APK
        if (window.AndroidBridge && window.AndroidBridge.saveVideoBase64) {
            try {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = reader.result.split(',')[1];
                    window.AndroidBridge.saveVideoBase64(base64, cleanName, blob.type);
                };
                reader.readAsDataURL(blob);
                return { success: true, method: 'android_bridge' };
            } catch (e) {
                console.warn('AndroidBridge call failed, falling back:', e);
            }
        }

        // 2. Web Share API (Mobile Browsers: iOS Safari & Android Chrome)
        // Allows direct "Save to Photos / Camera Roll" or sharing to apps
        const file = new File([blob], cleanName, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: 'Cleaned Video',
                    text: 'Cleaned with CrystalClear AI'
                });
                return { success: true, method: 'web_share' };
            } catch (err) {
                if (err.name === 'AbortError') {
                    return { success: false, method: 'user_cancelled' };
                }
            }
        }

        // 3. Direct Anchor Download Fallback
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = cleanName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        }, 3000);

        return { success: true, method: 'direct_download' };
    }
}
