"""
GREENWAVE — Camera perception data models (Step 8)

Pydantic models for the YOLO detection → traffic demand pipeline.
All detection data originates from actual processed video frames.
"""
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class VehicleClass(str, Enum):
    CAR = "car"
    BUS = "bus"
    TRUCK = "truck"
    MOTORCYCLE = "motorcycle"


# YOLO class ID → our vehicle class mapping (COCO dataset classes)
# Class 1 (bicycle) is skipped — not a motorized vehicle.
YOLO_CLASS_MAP: dict[int, VehicleClass] = {
    2: VehicleClass.CAR,          # car
    3: VehicleClass.MOTORCYCLE,   # motorcycle
    5: VehicleClass.BUS,          # bus
    7: VehicleClass.TRUCK,        # truck
}

# Classes we actually track
TRACKED_CLASSES = {VehicleClass.CAR, VehicleClass.BUS, VehicleClass.TRUCK, VehicleClass.MOTORCYCLE}


class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def center_x(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def center_y(self) -> float:
        return (self.y1 + self.y2) / 2

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1


class VehicleObservation(BaseModel):
    track_id: int
    vehicle_class: VehicleClass
    confidence: float
    bbox: BoundingBox
    timestamp: float
    approach_id: Optional[str] = None
    direction: Optional[str] = None
    speed_px_per_frame: float = 0.0
    is_stopped: bool = False


class ApproachMetrics(BaseModel):
    approach_id: str
    vehicle_count: int = 0
    cars: int = 0
    buses: int = 0
    trucks: int = 0
    motorcycles: int = 0
    estimated_queue: int = 0
    density: float = 0.0  # 0..1
    avg_confidence: float = 0.0
    approaching_count: int = 0
    stopped_count: int = 0
    moving_count: int = 0


class CameraStatus(str, Enum):
    ONLINE = "ONLINE"
    DEGRADED = "DEGRADED"
    OFFLINE = "OFFLINE"


class PerceptionSource(str, Enum):
    CAMERA = "CAMERA"
    SIMULATION = "SIMULATION"
    FUSED = "FUSED"


class FrameResult(BaseModel):
    frame_number: int
    timestamp: float
    detections: list[VehicleObservation]
    inference_ms: float
    fps: float
    total_vehicles: int
    active_tracks: int


class TrafficDemandObservation(BaseModel):
    source: PerceptionSource
    intersection_id: str
    timestamp: float

    # Main approach (M group)
    m_vehicle_count: int = 0
    m_estimated_queue: int = 0
    m_density: float = 0.0
    m_approaching: int = 0
    m_stopped: int = 0

    # Cross approach (X group)
    x_vehicle_count: int = 0
    x_estimated_queue: int = 0
    x_density: float = 0.0
    x_approaching: int = 0
    x_stopped: int = 0

    # Fusion weights (how much to trust camera vs simulation)
    camera_weight: float = 0.0
    simulation_weight: float = 1.0


class CameraMetrics(BaseModel):
    camera_id: str = "CAM-01"
    status: CameraStatus = CameraStatus.OFFLINE
    intersection_id: str = ""
    fps: float = 0.0
    inference_fps: float = 0.0
    total_detections: int = 0
    active_tracks: int = 0
    estimated_queue: int = 0
    traffic_density: float = 0.0
    frame_number: int = 0
    approaches: list[ApproachMetrics] = []


class PerceptionConfig(BaseModel):
    confidence_threshold: float = Field(default=0.35, ge=0.0, le=1.0)
    nms_threshold: float = Field(default=0.45, ge=0.0, le=1.0)
    inference_interval: int = Field(default=2, ge=1, le=10)
    max_queue_px: float = Field(default=80.0, description="max px from stop line for queue")
    approach_depth_px: float = Field(default=250.0, description="depth of approach zone")
    density_capacity: int = Field(default=20, description="max vehicles for full density")
    roi_definitions: dict[str, dict] = Field(default_factory=lambda: {})
