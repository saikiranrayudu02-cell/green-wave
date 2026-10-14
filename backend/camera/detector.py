"""
GREENWAVE — YOLO vehicle detection + tracking (Step 8)

Uses pretrained YOLO (yolo11n.pt) for vehicle perception from traffic-camera
video. GreenWave honestly states: "YOLO provides vehicle perception from
traffic-camera video."

This module does NOT claim custom training or novel AI.
"""
import time
import numpy as np
from typing import Optional
from .models import (
    VehicleObservation, VehicleClass, BoundingBox, FrameResult,
    TRACKED_CLASSES, PerceptionConfig,
)

# COO class IDs we track
_COYO_CLASSES = [2, 3, 5, 7]  # car, motorcycle, bus, truck
_CLASS_MAP = {
    2: VehicleClass.CAR,
    3: VehicleClass.MOTORCYCLE,
    5: VehicleClass.BUS,
    7: VehicleClass.TRUCK,
}


class YOLEDetector:
    """Lightweight YOLO vehicle detector with frame sampling."""

    def __init__(self, config: Optional[PerceptionConfig] = None):
        self.config = config or PerceptionConfig()
        self._model = None
        self._frame_count = 0
        self._total_inference_ms = 0.0
        self._inference_count = 0
        self._last_detections: list[VehicleObservation] = []
        self._track_history: dict[int, list[tuple[float, float]]] = {}
        self._track_speed: dict[int, float] = {}
        self._track_stopped_frames: dict[int, int] = {}

    def load_model(self) -> bool:
        """Load YOLO model. Returns True on success."""
        try:
            from ultralytics import YOLO
            self._model = YOLO("yolo11n.pt")
            return True
        except Exception as e:
            print(f"[GREENWAVE] YOLO model load failed: {e}")
            self._model = None
            return False

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    def detect_frame(
        self,
        frame: np.ndarray,
        timestamp: float,
        roi_masks: Optional[dict[str, np.ndarray]] = None,
    ) -> FrameResult:
        """Run YOLO inference on a single frame. Returns structured detections."""
        self._frame_count += 1
        start = time.perf_counter()

        detections: list[VehicleObservation] = []

        if self._model is not None:
            try:
                results = self._model(
                    frame,
                    conf=self.config.confidence_threshold,
                    iou=self.config.nms_threshold,
                    classes=_COYO_CLASSES,
                    verbose=False,
                )
                if results and len(results) > 0:
                    result = results[0]
                    if result.boxes is not None:
                        for box in result.boxes:
                            cls_id = int(box.cls[0])
                            if cls_id not in _CLASS_MAP:
                                continue
                            conf = float(box.conf[0])
                            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                            bbox = BoundingBox(
                                x1=float(x1), y1=float(y1),
                                x2=float(x2), y2=float(y2),
                            )
                            track_id = int(box.id[0]) if box.id is not None else self._frame_count * 1000 + len(detections)

                            # Track speed and stopped state
                            speed = self._update_track(track_id, bbox, timestamp)
                            is_stopped = self._is_stopped(track_id)

                            # Assign approach based on ROI if available
                            approach_id = self._assign_approach(bbox.center_x, bbox.center_y, roi_masks) if roi_masks else None

                            obs = VehicleObservation(
                                track_id=track_id,
                                vehicle_class=_CLASS_MAP[cls_id],
                                confidence=conf,
                                bbox=bbox,
                                timestamp=timestamp,
                                approach_id=approach_id,
                                speed_px_per_frame=speed,
                                is_stopped=is_stopped,
                            )
                            detections.append(obs)

            except Exception as e:
                print(f"[GREENWAVE] YOLO inference error: {e}")

        elapsed_ms = (time.perf_counter() - start) * 1000
        self._total_inference_ms += elapsed_ms
        self._inference_count += 1
        self._last_detections = detections

        inference_fps = 1000.0 / max(1.0, elapsed_ms)
        avg_fps = (
            1000.0 / (self._total_inference_ms / max(1, self._inference_count))
            if self._inference_count > 0 else 0.0
        )

        return FrameResult(
            frame_number=self._frame_count,
            timestamp=timestamp,
            detections=detections,
            inference_ms=round(elapsed_ms, 1),
            fps=round(inference_fps, 1),
            total_vehicles=len(detections),
            active_tracks=len(set(d.track_id for d in detections)),
        )

    def _update_track(self, track_id: int, bbox: BoundingBox, timestamp: float) -> float:
        """Update track history and compute speed. Returns px/frame."""
        center = (bbox.center_x, bbox.center_y)
        history = self._track_history.setdefault(track_id, [])
        speed = 0.0

        if history:
            prev_x, prev_y = history[-1]
            speed = ((center[0] - prev_x) ** 2 + (center[1] - prev_y) ** 2) ** 0.5

        history.append(center)
        if len(history) > 15:
            history.pop(0)

        # Track stopped frames
        stopped_frames = self._track_stopped_frames.get(track_id, 0)
        if speed < 1.5:
            stopped_frames += 1
        else:
            stopped_frames = 0
        self._track_stopped_frames[track_id] = stopped_frames
        self._track_speed[track_id] = speed

        return speed

    def _is_stopped(self, track_id: int) -> bool:
        """Vehicle is considered stopped after 5+ low-speed frames."""
        return self._track_stopped_frames.get(track_id, 0) >= 5

    def _assign_approach(
        self, cx: float, cy: float, roi_masks: Optional[dict[str, np.ndarray]]
    ) -> Optional[str]:
        """Assign vehicle to an approach based on ROI mask hit."""
        if not roi_masks:
            return None
        for approach_id, mask in roi_masks.items():
            if 0 <= int(cy) < mask.shape[0] and 0 <= int(cx) < mask.shape[1]:
                if mask[int(cy), int(cx)] > 0:
                    return approach_id
        return None

    @property
    def last_detections(self) -> list[VehicleObservation]:
        return self._last_detections
