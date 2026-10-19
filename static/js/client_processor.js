/**
 * ClientVideoProcessor - Full Video Inpainting Pipeline inside the Browser
 * Processes videos frame-by-frame, preserves audio, tracks progress & ETA, and exports downloadable video.
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

        // Processing canvas
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }

    cancel() {
        this.isCancelled = true;
    }

    async start() {
        const video = this.video;
        const box = this.box;

        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        const duration = video.duration || 5;
        const fps = this.options.fps || 30;
        const totalFrames = Math.max(1, Math.round(duration * fps));

        this.canvas.width = width;
        this.canvas.height = height;

        // Check supported MediaRecorder formats
        const mimeTypes = [
            'video/mp4;codecs=avc1,mp4a.40.2',
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
        try {
            mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: selectedMime,
                videoBitsPerSecond: 8000000 // 8 Mbps high quality
            });
        } catch (err) {
            // Fallback to default options
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
                resolve({ blobUrl, blob });
            };
        });

        mediaRecorder.start();

        const startTime = performance.now();
        let frameCount = 0;
        const frameInterval = 1.0 / fps;

        try {
            for (let f = 0; f < totalFrames; f++) {
                if (this.isCancelled) {
                    mediaRecorder.stop();
                    throw new Error('Processing cancelled by user.');
                }

                const targetTime = Math.min(duration, f * frameInterval);

                // Seek to frame
                await this.seekVideoTo(video, targetTime);

                // Draw video frame to processing canvas
                this.ctx.drawImage(video, 0, 0, width, height);

                // Inpaint the watermark region
                this.inpainter.inpaintCanvas(this.ctx, box);

                frameCount++;
                const now = performance.now();
                const elapsedSec = (now - startTime) / 1000;
                const currentFps = frameCount / (elapsedSec || 0.001);
                const percent = Math.min(100, (frameCount / totalFrames) * 100);
                const remainingFrames = Math.max(0, totalFrames - frameCount);
                const etaSeconds = currentFps > 0 ? Math.round(remainingFrames / currentFps) : 0;

                // Sample thumbnail preview periodically
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

                // Yield to event loop to keep UI smooth
                await new Promise(r => setTimeout(r, 0));
            }

            // Final frame capture & stop recorder
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
                    blob: result.blob
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
}
