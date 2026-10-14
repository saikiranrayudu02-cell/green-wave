"""
GREENWAVE — Camera perception backend (Step 8)

FastAPI server that processes traffic-camera video frames through a
pretrained YOLO model, tracks vehicles, and produces traffic-demand
observations for the GreenWave signal optimizer.

Usage:
    python3.11 -m uvicorn backend.main:app --host 127.0.0.1 --port 8099

Endpoints:
    GET  /health          — server + model status
    POST /detect/frame    — process a single frame (base64 image)
    POST /detect/video    — process a video file segment
    GET  /status          — current perception status
    POST /config          — update perception config
"""
import base64
import time
import tempfile
import os
import threading
import queue
from io import BytesIO

import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .camera.detector import YOLEDetector
from .camera.perception import PerceptionEngine
from .camera.models import (
    PerceptionConfig, CameraStatus, CameraMetrics, PerceptionSource,
    FrameResult,
)

app = FastAPI(title="GreenWave Camera Perception", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- singletons ----
config = PerceptionConfig()
detector = YOLEDetector(config)
perception = PerceptionEngine(config)

_model_loaded = False
_latest_status: dict = {}
_latest_frame_result: FrameResult | None = None
_latest_approach_metrics: dict = {}
_video_thread: threading.Thread | None = None
_video_queue: queue.Queue = queue.Queue(maxsize=4)
_video_running = False
_intersection_id = ""


@app.on_event("startup")
def startup():
    global _model_loaded
    print("[GREENWAVE] Loading YOLO model...")
    _model_loaded = detector.load_model()
    status = "ONLINE" if _model_loaded else "DEGRADED"
    print(f"[GREENWAVE] Model status: {status}")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": _model_loaded,
        "camera_status": "ONLINE" if _model_loaded else "DEGRADED",
        "frames_processed": detector._frame_count,
    }


@app.get("/status")
def status():
    return {
        "camera_status": CameraStatus.ONLINE.value if _model_loaded else CameraStatus.OFFLINE.value,
        "model_loaded": _model_loaded,
        "intersection_id": _intersection_id,
        "frame_number": detector._frame_count,
        "total_detections": detector._cumulative_detections if hasattr(detector, '_cumulative_detections') else 0,
        "active_tracks": len(set(d.track_id for d in detector.last_detections)),
        "latest_metrics": _latest_approach_metrics,
    }


@app.post("/config")
def update_config(new_config: PerceptionConfig):
    global config
    config = new_config
    detector.config = config
    perception.config = config
    return {"status": "updated", "config": config.model_dump()}


@app.post("/detect/frame")
async def detect_frame(
    image: UploadFile = File(...),
    intersection_id: str = "",
    roi_json: str = "",
):
    """Process a single image frame through YOLO detection."""
    global _latest_frame_result, _latest_approach_metrics, _intersection_id

    if intersection_id:
        _intersection_id = intersection_id

    # Read image
    contents = await image.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    # Run detection
    timestamp = time.time()
    result = detector.detect_frame(frame, timestamp)

    # Process into approach metrics
    metrics = perception.process_frame(result)
    _latest_frame_result = result
    _latest_approach_metrics = {k: v.model_dump() for k, v in metrics.items()}

    return {
        "frame_number": result.frame_number,
        "timestamp": result.timestamp,
        "inference_ms": result.inference_ms,
        "fps": result.fps,
        "total_vehicles": result.total_vehicles,
        "active_tracks": result.active_tracks,
        "detections": [d.model_dump() for d in result.detections],
        "approaches": {k: v.model_dump() for k, v in metrics.items()},
        "camera_metrics": perception.get_camera_metrics(result, metrics, _intersection_id).model_dump(),
    }


@app.post("/detect/frame/base64")
async def detect_frame_base64(payload: dict):
    """Process a base64-encoded image frame."""
    global _latest_frame_result, _latest_approach_metrics, _intersection_id

    image_b64 = payload.get("image", "")
    intersection_id = payload.get("intersection_id", "")
    if intersection_id:
        _intersection_id = intersection_id

    try:
        image_bytes = base64.b64decode(image_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    nparr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    timestamp = time.time()
    result = detector.detect_frame(frame, timestamp)
    metrics = perception.process_frame(result)
    _latest_frame_result = result
    _latest_approach_metrics = {k: v.model_dump() for k, v in metrics.items()}

    return {
        "frame_number": result.frame_number,
        "timestamp": result.timestamp,
        "inference_ms": result.inference_ms,
        "fps": result.fps,
        "total_vehicles": result.total_vehicles,
        "active_tracks": result.active_tracks,
        "detections": [d.model_dump() for d in result.detections],
        "approaches": {k: v.model_dump() for k, v in metrics.items()},
        "camera_metrics": perception.get_camera_metrics(result, metrics, _intersection_id).model_dump(),
    }


@app.post("/detect/video")
async def detect_video(
    video: UploadFile = File(...),
    intersection_id: str = "",
    sample_rate: int = 2,
):
    """Process a video file and return detection results for sampled frames."""
    global _intersection_id, _video_running

    if intersection_id:
        _intersection_id = intersection_id

    # Save to temp file
    suffix = os.path.splitext(video.filename or "video.mp4")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        contents = await video.read()
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Could not open video")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_interval = max(1, int(sample_rate))

        all_results = []
        frame_num = 0
        processed = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_num % frame_interval == 0:
                timestamp = frame_num / fps
                result = detector.detect_frame(frame, timestamp)
                metrics = perception.process_frame(result)
                all_results.append({
                    "frame": frame_num,
                    "timestamp": round(timestamp, 2),
                    "vehicles": result.total_vehicles,
                    "inference_ms": result.inference_ms,
                    "approaches": {k: v.model_dump() for k, v in metrics.items()},
                })
                processed += 1
            frame_num += 1

        cap.release()

        return {
            "status": "complete",
            "total_frames": total_frames,
            "processed_frames": processed,
            "fps": fps,
            "sample_rate": frame_interval,
            "results": all_results,
        }
    finally:
        os.unlink(tmp_path)


@app.post("/camera/start")
def start_camera(intersection_id: str = ""):
    """Start camera processing (for future live camera support)."""
    global _intersection_id, _video_running
    _intersection_id = intersection_id
    return {"status": "started", "intersection_id": intersection_id}


@app.post("/camera/stop")
def stop_camera():
    """Stop camera processing."""
    global _video_running
    _video_running = False
    return {"status": "stopped"}
