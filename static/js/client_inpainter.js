/**
 * ClientInpainter - High-Performance Client-Side Inpainting Engine
 * Works 100% inside the browser without requiring any backend.
 */
class ClientInpainter {
    constructor(options = {}) {
        this.mode = options.mode || 'crystal_clear'; // 'crystal_clear', 'delogo', 'blur'
        this.featherRadius = options.featherRadius !== undefined ? options.featherRadius : 4;
        this.inpaintRadius = options.inpaintRadius !== undefined ? options.inpaintRadius : 5;
        this.temporalBlend = options.temporalBlend !== undefined ? options.temporalBlend : 0.25;
        this.prevPatch = null;
    }

    reset() {
        this.prevPatch = null;
    }

    /**
     * Inpaints the specified bounding box directly on an HTML5 2D Canvas Context.
     */
    inpaintCanvas(ctx, box, mode = null) {
        if (!box || box.width <= 2 || box.height <= 2) return;

        const currentMode = mode || this.mode;
        const cvWidth = ctx.canvas.width;
        const cvHeight = ctx.canvas.height;

        const x = Math.max(0, Math.min(cvWidth - 1, Math.round(box.x)));
        const y = Math.max(0, Math.min(cvHeight - 1, Math.round(box.y)));
        const w = Math.min(cvWidth - x, Math.round(box.width));
        const h = Math.min(cvHeight - y, Math.round(box.height));

        if (w <= 2 || h <= 2) return;

        if (currentMode === 'blur') {
            this.applyFeatheredBlur(ctx, x, y, w, h);
            return;
        }

        // Crystal Clear & Delogo Inpainting
        const pad = Math.max(6, Math.min(24, Math.round(this.inpaintRadius * 2)));
        const px1 = Math.max(0, x - pad);
        const py1 = Math.max(0, y - pad);
        const px2 = Math.min(cvWidth, x + w + pad);
        const py2 = Math.min(cvHeight, y + h + pad);

        const cropW = px2 - px1;
        const cropH = py2 - py1;

        if (cropW <= 0 || cropH <= 0) return;

        const imgData = ctx.getImageData(px1, py1, cropW, cropH);
        const data = imgData.data;

        // Relative watermark box coordinates inside the crop
        const rx1 = x - px1;
        const ry1 = y - py1;
        const rx2 = rx1 + w;
        const ry2 = ry1 + h;

        // Sample boundary border pixels surrounding the watermark
        this.interpolateBorders(data, cropW, cropH, rx1, ry1, rx2, ry2);

        // Put inpainted pixels back to canvas
        ctx.putImageData(imgData, px1, py1);
    }

    /**
     * Seamless edge-aware border interpolation with soft boundary feathering.
     */
    interpolateBorders(data, width, height, x1, y1, x2, y2) {
        const boxW = x2 - x1;
        const boxH = y2 - y1;
        const feather = Math.max(1, Math.min(Math.min(boxW, boxH) / 4, this.featherRadius));

        // Sample top border strip
        const topRowY = Math.max(0, y1 - 2);
        // Sample bottom border strip
        const botRowY = Math.min(height - 1, y2 + 1);
        // Sample left border column
        const leftColX = Math.max(0, x1 - 2);
        // Sample right border column
        const rightColX = Math.min(width - 1, x2 + 1);

        for (let py = y1; py < y2; py++) {
            const vFactor = boxH > 1 ? (py - y1) / (boxH - 1) : 0.5;
            // Cosine smooth interpolation factor
            const vSmooth = (1 - Math.cos(vFactor * Math.PI)) / 2;

            for (let px = x1; px < x2; px++) {
                const hFactor = boxW > 1 ? (px - x1) / (boxW - 1) : 0.5;
                const hSmooth = (1 - Math.cos(hFactor * Math.PI)) / 2;

                const topIdx = (topRowY * width + px) * 4;
                const botIdx = (botRowY * width + px) * 4;
                const leftIdx = (py * width + leftColX) * 4;
                const rightIdx = (py * width + rightColX) * 4;

                // Vertical interpolation between top and bottom borders
                const rV = data[topIdx] * (1 - vSmooth) + data[botIdx] * vSmooth;
                const gV = data[topIdx + 1] * (1 - vSmooth) + data[botIdx + 1] * vSmooth;
                const bV = data[topIdx + 2] * (1 - vSmooth) + data[botIdx + 2] * vSmooth;

                // Horizontal interpolation between left and right borders
                const rH = data[leftIdx] * (1 - hSmooth) + data[rightIdx] * hSmooth;
                const gH = data[leftIdx + 1] * (1 - hSmooth) + data[rightIdx + 1] * hSmooth;
                const bH = data[leftIdx + 2] * (1 - hSmooth) + data[rightIdx + 2] * hSmooth;

                // Calculate weights based on distance to nearest edge
                const distLeft = px - x1;
                const distRight = x2 - 1 - px;
                const distTop = py - y1;
                const distBot = y2 - 1 - py;

                const minDistH = Math.min(distLeft, distRight);
                const minDistV = Math.min(distTop, distBot);

                let weightH = minDistV / (minDistH + minDistV + 1e-5);
                let weightV = 1.0 - weightH;

                let inpaintR = rH * weightH + rV * weightV;
                let inpaintG = gH * weightH + gV * weightV;
                let inpaintB = bH * weightH + bV * weightV;

                // Natural subtle texture grain matching
                const noise = (Math.random() - 0.5) * 3;
                inpaintR = Math.max(0, Math.min(255, inpaintR + noise));
                inpaintG = Math.max(0, Math.min(255, inpaintG + noise));
                inpaintB = Math.max(0, Math.min(255, inpaintB + noise));

                // Feathering factor at the edges of the box
                const edgeDist = Math.min(minDistH, minDistV);
                let alpha = 1.0;
                if (edgeDist < feather) {
                    alpha = (1 - Math.cos((edgeDist / feather) * Math.PI)) / 2;
                }

                const targetIdx = (py * width + px) * 4;
                data[targetIdx] = Math.round(inpaintR * alpha + data[targetIdx] * (1 - alpha));
                data[targetIdx + 1] = Math.round(inpaintG * alpha + data[targetIdx + 1] * (1 - alpha));
                data[targetIdx + 2] = Math.round(inpaintB * alpha + data[targetIdx + 2] * (1 - alpha));
            }
        }
    }

    /**
     * Applies a soft feathered Gaussian blur over the selected area.
     */
    applyFeatheredBlur(ctx, x, y, w, h) {
        ctx.save();
        ctx.filter = `blur(${Math.max(4, Math.round(w / 15))}px)`;
        ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
        ctx.restore();
    }
}
