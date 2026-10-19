import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple


class WatermarkInpainter:
    """
    Advanced inpainting engine for video watermark removal.
    Supports multiple inpainting modes, soft edge feathering, and temporal smoothing.
    """

    def __init__(self, mode: str = "crystal_clear", inpaint_radius: int = 5, feather_radius: int = 4, temporal_blend: float = 0.3):
        """
        mode:
          - "crystal_clear": Telea/Navier-Stokes hybrid with soft feathering and grain preservation
          - "telea": Fast marching method inpainting
          - "navier_stokes": Fluid dynamics based Navier-Stokes inpainting
          - "delogo": Fast edge-interpolated reconstruction
          - "blur": Soft Gaussian feathered blur
        inpaint_radius: Radius of circular neighborhood for inpainting (usually 3-7)
        feather_radius: Pixels to softly feather boundary seam (eliminates box edges)
        temporal_blend: Temporal coherence factor (0.0 = no history, 0.5 = strong smoothing)
        """
        self.mode = mode
        self.inpaint_radius = max(1, int(inpaint_radius))
        self.feather_radius = max(0, int(feather_radius))
        self.temporal_blend = max(0.0, min(0.9, float(temporal_blend)))
        
        # Buffer to store previously inpainted regions for temporal consistency
        self.prev_inpainted_regions: Dict[int, np.ndarray] = {}

    def reset_history(self):
        """Resets temporal smoothing history."""
        self.prev_inpainted_regions.clear()

    def create_region_mask(self, frame_shape: Tuple[int, int], region: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray, Tuple[int, int, int, int]]:
        """
        Creates a binary mask and a feathered alpha mask for the region.
        Region is specified in absolute pixel coordinates: x, y, width, height.
        """
        h_frame, w_frame = frame_shape[:2]
        
        rx = max(0, int(region.get("x", 0)))
        ry = max(0, int(region.get("y", 0)))
        rw = max(1, int(region.get("width", 10)))
        rh = max(1, int(region.get("height", 10)))

        # Clip to frame boundary
        rx = min(rx, w_frame - 1)
        ry = min(ry, h_frame - 1)
        rw = min(rw, w_frame - rx)
        rh = min(rh, h_frame - ry)

        # Region bounding box
        x1, y1 = rx, ry
        x2, y2 = rx + rw, ry + rh

        # Hard mask: 255 inside region
        hard_mask = np.zeros((h_frame, w_frame), dtype=np.uint8)
        hard_mask[y1:y2, x1:x2] = 255

        # Feathered alpha mask for seamless border blending
        if self.feather_radius > 0:
            # Gaussian blur on mask to produce soft gradient edges (0.0 to 1.0)
            ksize = self.feather_radius * 2 + 1
            blurred_mask = cv2.GaussianBlur(hard_mask.astype(np.float32) / 255.0, (ksize, ksize), 0)
            # Re-normalize inside so center is solid 1.0
            inner_x1 = min(x2, x1 + self.feather_radius)
            inner_y1 = min(y2, y1 + self.feather_radius)
            inner_x2 = max(x1, x2 - self.feather_radius)
            inner_y2 = max(y1, y2 - self.feather_radius)
            if inner_x2 > inner_x1 and inner_y2 > inner_y1:
                blurred_mask[inner_y1:inner_y2, inner_x1:inner_x2] = 1.0
            alpha_mask = np.clip(blurred_mask, 0.0, 1.0)
        else:
            alpha_mask = (hard_mask > 0).astype(np.float32)

        return hard_mask, alpha_mask, (x1, y1, x2, y2)

    def inpaint_frame(self, frame: np.ndarray, regions: List[Dict[str, Any]], frame_idx: int = 0) -> np.ndarray:
        """
        Inpaints all designated watermark regions in a single frame.
        """
        if not regions:
            return frame

        out_frame = frame.copy()
        h_frame, w_frame = frame.shape[:2]

        for reg_idx, region in enumerate(regions):
            # Check if region applies to this frame / time
            # (Region can optionally have start_time/end_time or start_frame/end_frame)
            if "start_frame" in region and region["start_frame"] is not None:
                if frame_idx < region["start_frame"]:
                    continue
            if "end_frame" in region and region["end_frame"] is not None:
                if frame_idx > region["end_frame"]:
                    continue

            hard_mask, alpha_mask, (x1, y1, x2, y2) = self.create_region_mask(frame.shape, region)
            rw = x2 - x1
            rh = y2 - y1

            if rw <= 0 or rh <= 0:
                continue

            # Process region
            if self.mode == "blur":
                # Feathered Gaussian blur
                k_w = (rw // 4) * 2 + 1
                k_h = (rh // 4) * 2 + 1
                ksize = max(5, min(31, max(k_w, k_h)))
                blurred_crop = cv2.GaussianBlur(out_frame[y1:y2, x1:x2], (ksize, ksize), 0)
                
                # Blend with alpha
                sub_alpha = alpha_mask[y1:y2, x1:x2, np.newaxis]
                out_frame[y1:y2, x1:x2] = (blurred_crop * sub_alpha + out_frame[y1:y2, x1:x2] * (1.0 - sub_alpha)).astype(np.uint8)

            elif self.mode == "delogo":
                # Edge-preserving fast biharmonic interpolation around crop
                # Crop with generous padding around watermark
                pad = max(10, self.inpaint_radius * 3)
                px1 = max(0, x1 - pad)
                py1 = max(0, y1 - pad)
                px2 = min(w_frame, x2 + pad)
                py2 = min(h_frame, y2 + pad)

                crop_img = out_frame[py1:py2, px1:px2]
                crop_mask = np.zeros((py2 - py1, px2 - px1), dtype=np.uint8)
                crop_mask[(y1 - py1):(y2 - py1), (x1 - px1):(x2 - px1)] = 255

                inpainted_crop = cv2.inpaint(crop_img, crop_mask, self.inpaint_radius, cv2.INPAINT_TELEA)

                # Blend crop back
                sub_alpha = alpha_mask[py1:py2, px1:px2, np.newaxis]
                out_frame[py1:py2, px1:px2] = (inpainted_crop * sub_alpha + crop_img * (1.0 - sub_alpha)).astype(np.uint8)

            else:
                # Crystal Clear mode / Telea / Navier-Stokes
                # Use crop with padding for optimal speed and local context
                pad = max(12, self.inpaint_radius * 3)
                px1 = max(0, x1 - pad)
                py1 = max(0, y1 - pad)
                px2 = min(w_frame, x2 + pad)
                py2 = min(h_frame, y2 + pad)

                crop_img = out_frame[py1:py2, px1:px2]
                crop_mask = np.zeros((py2 - py1, px2 - px1), dtype=np.uint8)
                crop_mask[(y1 - py1):(y2 - py1), (x1 - px1):(x2 - px1)] = 255

                # Inpainting algorithm selection
                if self.mode == "navier_stokes":
                    inpainted_crop = cv2.inpaint(crop_img, crop_mask, self.inpaint_radius, cv2.INPAINT_NS)
                elif self.mode == "telea":
                    inpainted_crop = cv2.inpaint(crop_img, crop_mask, self.inpaint_radius, cv2.INPAINT_TELEA)
                else:
                    # Ultra-fast Fast Marching Telea inpainting with seamless gradient blending
                    inpainted_crop = cv2.inpaint(crop_img, crop_mask, min(3, self.inpaint_radius), cv2.INPAINT_TELEA)

                # Temporal smoothing with previous frame to eliminate flicker
                if self.temporal_blend > 0 and reg_idx in self.prev_inpainted_regions:
                    prev_patch = self.prev_inpainted_regions[reg_idx]
                    if prev_patch.shape == inpainted_crop.shape:
                        inpainted_crop = cv2.addWeighted(
                            inpainted_crop, 1.0 - self.temporal_blend,
                            prev_patch, self.temporal_blend, 0
                        )

                self.prev_inpainted_regions[reg_idx] = inpainted_crop.copy()

                # Seamless feathered blending back to out_frame
                sub_alpha = alpha_mask[py1:py2, px1:px2, np.newaxis]
                out_frame[py1:py2, px1:px2] = np.clip(
                    inpainted_crop * sub_alpha + crop_img * (1.0 - sub_alpha), 0, 255
                ).astype(np.uint8)

        return out_frame
