/**
 * CanvasSelector - Interactive Watermark Bounding Box Selector
 * Handles drawing, dragging, resizing, and coordinate scaling between canvas & real video pixels.
 */
class CanvasSelector {
    constructor(canvas, videoElement, onBoxChange) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.video = videoElement;
        this.onBoxChange = onBoxChange;

        // Current selection box in real video coordinates: { x, y, width, height }
        this.box = null;

        // Interaction state
        this.isInteracting = false;
        this.interactionType = null; // 'draw', 'move', or resize handle ('nw', 'se', etc.)
        this.dragStart = { x: 0, y: 0 };
        this.boxStart = null;
        this.activeHandle = null;

        // Handle size in canvas display pixels
        this.handleSize = 8;
        this.handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

        // Animation dash offset
        this.dashOffset = 0;

        this.initEvents();
    }

    setBox(box) {
        this.box = box ? { ...box } : null;
        if (this.onBoxChange) this.onBoxChange(this.box);
        this.render();
    }

    getBox() {
        return this.box;
    }

    clearBox() {
        this.box = null;
        if (this.onBoxChange) this.onBoxChange(null);
        this.render();
    }

    // Convert mouse/touch canvas event coordinates to video pixel coordinates
    eventToVideoCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;

        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        return {
            x: Math.round(canvasX * scaleX),
            y: Math.round(canvasY * scaleY),
            canvasX: canvasX,
            canvasY: canvasY
        };
    }

    // Convert video coordinates to canvas element display coordinates for hit-testing
    videoToCanvasDisplayCoords(vx, vy) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width / this.canvas.width;
        const scaleY = rect.height / this.canvas.height;
        return {
            x: vx * scaleX,
            y: vy * scaleY
        };
    }

    getHandleRects() {
        if (!this.box) return {};
        const { x, y, width, height } = this.box;
        const hs = this.handleSize;
        const halfHs = hs / 2;

        const p1 = this.videoToCanvasDisplayCoords(x, y);
        const p2 = this.videoToCanvasDisplayCoords(x + width, y + height);

        const bx = p1.x;
        const by = p1.y;
        const bw = p2.x - p1.x;
        const bh = p2.y - p1.y;

        return {
            'nw': { x: bx - halfHs, y: by - halfHs, w: hs, h: hs },
            'n':  { x: bx + bw / 2 - halfHs, y: by - halfHs, w: hs, h: hs },
            'ne': { x: bx + bw - halfHs, y: by - halfHs, w: hs, h: hs },
            'e':  { x: bx + bw - halfHs, y: by + bh / 2 - halfHs, w: hs, h: hs },
            'se': { x: bx + bw - halfHs, y: by + bh - halfHs, w: hs, h: hs },
            's':  { x: bx + bw / 2 - halfHs, y: by + bh - halfHs, w: hs, h: hs },
            'sw': { x: bx - halfHs, y: by + bh - halfHs, w: hs, h: hs },
            'w':  { x: bx - halfHs, y: by + bh / 2 - halfHs, w: hs, h: hs },
        };
    }

    getHitTarget(canvasX, canvasY) {
        if (!this.box) return { type: 'draw' };

        // Test handles first
        const handles = this.getHandleRects();
        for (const [handle, r] of Object.entries(handles)) {
            if (canvasX >= r.x - 3 && canvasX <= r.x + r.w + 3 &&
                canvasY >= r.y - 3 && canvasY <= r.y + r.h + 3) {
                return { type: 'resize', handle };
            }
        }

        // Test inside box
        const p1 = this.videoToCanvasDisplayCoords(this.box.x, this.box.y);
        const p2 = this.videoToCanvasDisplayCoords(this.box.x + this.box.width, this.box.y + this.box.height);
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);

        if (canvasX >= minX && canvasX <= maxX && canvasY >= minY && canvasY <= maxY) {
            return { type: 'move' };
        }

        return { type: 'draw' };
    }

    updateCursor(canvasX, canvasY) {
        const hit = this.getHitTarget(canvasX, canvasY);
        if (hit.type === 'resize') {
            const cursors = {
                'nw': 'nwse-resize', 'se': 'nwse-resize',
                'ne': 'nesw-resize', 'sw': 'nesw-resize',
                'n': 'ns-resize', 's': 'ns-resize',
                'e': 'ew-resize', 'w': 'ew-resize'
            };
            this.canvas.style.cursor = cursors[hit.handle] || 'pointer';
        } else if (hit.type === 'move') {
            this.canvas.style.cursor = 'move';
        } else {
            this.canvas.style.cursor = 'crosshair';
        }
    }

    initEvents() {
        const onDown = (e) => {
            const coords = this.eventToVideoCoords(e);
            this.isInteracting = true;
            this.dragStart = coords;

            const hit = this.getHitTarget(coords.canvasX, coords.canvasY);
            this.interactionType = hit.type;
            this.activeHandle = hit.handle || null;

            if (hit.type === 'move' || hit.type === 'resize') {
                this.boxStart = { ...this.box };
            } else {
                // Start drawing new box
                this.box = { x: coords.x, y: coords.y, width: 0, height: 0 };
                this.boxStart = { ...this.box };
            }
            this.render();
        };

        const onMove = (e) => {
            const coords = this.eventToVideoCoords(e);

            if (!this.isInteracting) {
                this.updateCursor(coords.canvasX, coords.canvasY);
                return;
            }

            const dx = coords.x - this.dragStart.x;
            const dy = coords.y - this.dragStart.y;
            const vw = this.canvas.width;
            const vh = this.canvas.height;

            if (this.interactionType === 'draw') {
                const rx = Math.min(this.dragStart.x, coords.x);
                const ry = Math.min(this.dragStart.y, coords.y);
                const rw = Math.abs(coords.x - this.dragStart.x);
                const rh = Math.abs(coords.y - this.dragStart.y);

                this.box = {
                    x: Math.max(0, Math.min(vw - 1, rx)),
                    y: Math.max(0, Math.min(vh - 1, ry)),
                    width: Math.min(vw - rx, rw),
                    height: Math.min(vh - ry, rh)
                };
            } else if (this.interactionType === 'move' && this.boxStart) {
                let newX = this.boxStart.x + dx;
                let newY = this.boxStart.y + dy;

                newX = Math.max(0, Math.min(vw - this.boxStart.width, newX));
                newY = Math.max(0, Math.min(vh - this.boxStart.height, newY));

                this.box = {
                    x: newX,
                    y: newY,
                    width: this.boxStart.width,
                    height: this.boxStart.height
                };
            } else if (this.interactionType === 'resize' && this.boxStart) {
                let x = this.boxStart.x;
                let y = this.boxStart.y;
                let w = this.boxStart.width;
                let h = this.boxStart.height;

                if (this.activeHandle.includes('e')) w += dx;
                if (this.activeHandle.includes('s')) h += dy;
                if (this.activeHandle.includes('w')) {
                    x += dx;
                    w -= dx;
                }
                if (this.activeHandle.includes('n')) {
                    y += dy;
                    h -= dy;
                }

                // Handle negative width / height flipping
                if (w < 10) w = 10;
                if (h < 10) h = 10;
                x = Math.max(0, Math.min(vw - w, x));
                y = Math.max(0, Math.min(vh - h, y));

                this.box = { x, y, width: w, height: h };
            }

            if (this.onBoxChange) this.onBoxChange(this.box);
            this.render();
        };

        const onUp = () => {
            if (this.isInteracting) {
                this.isInteracting = false;
                this.interactionType = null;
                this.activeHandle = null;

                // If drawn box is tiny, discard it
                if (this.box && (this.box.width < 8 || this.box.height < 8)) {
                    this.clearBox();
                } else if (this.box && this.onBoxChange) {
                    this.onBoxChange(this.box);
                }
                this.render();
            }
        };

        this.canvas.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(e); }, { passive: false });
        window.addEventListener('touchmove', (e) => { if (this.isInteracting) onMove(e); });
        window.addEventListener('touchend', onUp);
    }

    render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        if (w === 0 || h === 0) return;

        // Draw current video frame
        if (this.video && this.video.readyState >= 2) {
            ctx.drawImage(this.video, 0, 0, w, h);
        } else {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, w, h);
        }

        // Draw selection box if defined
        if (this.box && this.box.width > 2 && this.box.height > 2) {
            const { x, y, width, height } = this.box;

            // Semi-transparent dark mask outside selection box to highlight watermark
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.beginPath();
            ctx.rect(0, 0, w, h);
            ctx.rect(x + width, y, -width, height); // counter-clockwise cutout
            ctx.fill();

            // Glow border
            ctx.save();
            ctx.shadowColor = 'rgba(99, 102, 241, 0.9)';
            ctx.shadowBlur = 12;

            // Box stroke (dashed vibrant indigo)
            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = Math.max(2, Math.round(w / 600));
            ctx.setLineDash([8, 4]);
            ctx.lineDashOffset = this.dashOffset;
            ctx.strokeRect(x, y, width, height);
            ctx.restore();

            // Corner accent markers
            const cLen = Math.min(18, Math.min(width, height) / 3);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = Math.max(3, Math.round(w / 450));
            ctx.setLineDash([]);

            // NW
            ctx.beginPath();
            ctx.moveTo(x, y + cLen); ctx.lineTo(x, y); ctx.lineTo(x + cLen, y);
            ctx.stroke();
            // NE
            ctx.beginPath();
            ctx.moveTo(x + width - cLen, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + cLen);
            ctx.stroke();
            // SE
            ctx.beginPath();
            ctx.moveTo(x + width, y + height - cLen); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width - cLen, y + height);
            ctx.stroke();
            // SW
            ctx.beginPath();
            ctx.moveTo(x + cLen, y + height); ctx.lineTo(x, y + height); ctx.lineTo(x, y + height - cLen);
            ctx.stroke();

            // Watermark badge label above box
            const labelText = `Watermark Area (${Math.round(width)}×${Math.round(height)})`;
            ctx.font = `600 ${Math.max(12, Math.round(w / 90))}px "Plus Jakarta Sans", sans-serif`;
            const textWidth = ctx.measureText(labelText).width;
            const badgeY = y > 24 ? y - 8 : y + height + 20;

            ctx.fillStyle = 'rgba(17, 24, 39, 0.9)';
            ctx.beginPath();
            ctx.roundRect(x, badgeY - 16, textWidth + 14, 22, 6);
            ctx.fill();

            ctx.fillStyle = '#a5b4fc';
            ctx.fillText(labelText, x + 7, badgeY);
        }
    }
}
