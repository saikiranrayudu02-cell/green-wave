"""
GREENWAVE — Traffic perception engine (Step 8)

Converts raw YOLO detections into structured traffic-demand observations
that the GreenWave signal optimizer can consume. Approach metrics, density
estimation, and queue calculation are all derived from actual camera
observations — never fabricated.
"""
from typing import Optional
from .models import (
    VehicleObservation, ApproachMetrics, FrameResult,
    TrafficDemandObservation, PerceptionSource, PerceptionConfig,
    CameraStatus, CameraMetrics, VehicleClass,
)


class PerceptionEngine:
    """Processes detection frames into traffic-demand observations."""

    def __init__(self, config: Optional[PerceptionConfig] = None):
        self.config = config or PerceptionConfig()
        self._cumulative_detections = 0
        self._approach_counts: dict[str, dict[str, list[VehicleObservation]]] = {}
        self._baseline_density: dict[str, float] = {}
        self._frame_count = 0

    def process_frame(
        self,
        result: FrameResult,
        roi_definitions: Optional[dict[str, dict]] = None,
    ) -> dict[str, ApproachMetrics]:
        """Process a frame result into per-approach metrics."""
        self._frame_count += 1
        self._cumulative_detections += len(result.detections)

        # Group detections by approach
        by_approach: dict[str, list[VehicleObservation]] = {}
        for det in result.detections:
            key = det.approach_id or "UNASSIGNED"
            by_approach.setdefault(key, []).append(det)

        # Calculate per-approach metrics
        metrics: dict[str, ApproachMetrics] = {}
        for approach_id, detections in by_approach.items():
            metrics[approach_id] = self._compute_approach_metrics(
                approach_id, detections, roi_definitions
            )

        # Update baseline density for anomaly detection
        for approach_id, m in metrics.items():
            if approach_id not in self._baseline_density:
                self._baseline_density[approach_id] = m.density
            else:
                # Exponential moving average
                self._baseline_density[approach_id] = (
                    0.95 * self._baseline_density[approach_id] + 0.05 * m.density
                )

        return metrics

    def _compute_approach_metrics(
        self,
        approach_id: str,
        detections: list[VehicleObservation],
        roi_definitions: Optional[dict[str, dict]] = None,
    ) -> ApproachMetrics:
        """Compute traffic metrics for one approach."""
        cars = sum(1 for d in detections if d.vehicle_class == VehicleClass.CAR)
        buses = sum(1 for d in detections if d.vehicle_class == VehicleClass.BUS)
        trucks = sum(1 for d in detections if d.vehicle_class == VehicleClass.TRUCK)
        motorcycles = sum(1 for d in detections if d.vehicle_class == VehicleClass.MOTORCYCLE)

        total = len(detections)
        stopped = sum(1 for d in detections if d.is_stopped)
        moving = total - stopped

        # Queue estimation: stopped vehicles near the bottom of the frame
        # (assuming camera looks down the approach — vehicles near stop line
        # are at the bottom). Simple heuristic: count stopped vehicles.
        estimated_queue = stopped

        # Density: vehicles / capacity
        capacity = self.config.density_capacity
        density = min(1.0, total / max(1, capacity))

        # Average confidence
        avg_conf = (
            sum(d.confidence for d in detections) / max(1, len(detections))
        ) if detections else 0.0

        # Approaching: vehicles that are moving toward the intersection
        # (within the approach zone and not stopped)
        approaching = moving

        return ApproachMetrics(
            approach_id=approach_id,
            vehicle_count=total,
            cars=cars,
            buses=buses,
            trucks=trucks,
            motorcycles=motorcycles,
            estimated_queue=estimated_queue,
            density=round(density, 3),
            avg_confidence=round(avg_conf, 3),
            approaching_count=approaching,
            stopped_count=stopped,
            moving_count=moving,
        )

    def compute_traffic_demand(
        self,
        intersection_id: str,
        approach_metrics: dict[str, ApproachMetrics],
        source: PerceptionSource = PerceptionSource.CAMERA,
    ) -> TrafficDemandObservation:
        """Convert approach metrics into a TrafficDemandObservation for the optimizer.

        Maps camera approaches to the M/X axis groups used by the signal optimizer.
        Convention: NORTH/SOUTH → M group, EAST/WEST → X group.
        Override roi_definitions to change this mapping.
        """
        m_approaches = ["NORTH", "SOUTH", "M"]
        x_approaches = ["EAST", "WEST", "X"]

        m_total = 0
        m_queue = 0
        m_density = 0.0
        m_approaching = 0
        m_stopped = 0
        m_count = 0

        x_total = 0
        x_queue = 0
        x_density = 0.0
        x_approaching = 0
        x_stopped = 0
        x_count = 0

        for aid, metrics in approach_metrics.items():
            aid_upper = aid.upper()
            if any(a in aid_upper for a in m_approaches):
                m_total += metrics.vehicle_count
                m_queue += metrics.estimated_queue
                m_density += metrics.density
                m_approaching += metrics.approaching_count
                m_stopped += metrics.stopped_count
                m_count += 1
            elif any(a in aid_upper for a in x_approaches):
                x_total += metrics.vehicle_count
                x_queue += metrics.estimated_queue
                x_density += metrics.density
                x_approaching += metrics.approaching_count
                x_stopped += metrics.stopped_count
                x_count += 1
            else:
                # Default: distribute evenly
                m_total += metrics.vehicle_count
                m_queue += metrics.estimated_queue
                m_density += metrics.density
                m_approaching += metrics.approaching_count
                m_stopped += metrics.stopped_count
                m_count += 1

        return TrafficDemandObservation(
            source=source,
            intersection_id=intersection_id,
            timestamp=approach_metrics[list(approach_metrics.keys())[0]].vehicle_count if approach_metrics else 0.0,
            m_vehicle_count=m_total,
            m_estimated_queue=m_queue,
            m_density=round(m_density / max(1, m_count), 3),
            m_approaching=m_approaching,
            m_stopped=m_stopped,
            x_vehicle_count=x_total,
            x_estimated_queue=x_queue,
            x_density=round(x_density / max(1, x_count), 3),
            x_approaching=x_approaching,
            x_stopped=x_stopped,
        )

    def get_anomaly_signal(
        self, current_density: float, approach_id: str
    ) -> Optional[str]:
        """Detect traffic surges by comparing current vs baseline density."""
        baseline = self._baseline_density.get(approach_id)
        if baseline is None:
            return None
        if baseline > 0.05 and current_density > baseline * 1.8 and current_density > 0.5:
            return "TRAFFIC SURGE DETECTED"
        if current_density > 0.85:
            return "CRITICAL DENSITY"
        return None

    def get_camera_metrics(
        self,
        frame_result: FrameResult,
        approach_metrics: dict[str, ApproachMetrics],
        intersection_id: str = "",
    ) -> CameraMetrics:
        """Build camera status metrics for the UI."""
        total_vehicles = frame_result.total_vehicles
        total_queue = sum(m.estimated_queue for m in approach_metrics.values())
        avg_density = (
            sum(m.density for m in approach_metrics.values()) / max(1, len(approach_metrics))
        )

        return CameraMetrics(
            camera_id="CAM-01",
            status=CameraStatus.ONLINE,
            intersection_id=intersection_id,
            fps=frame_result.fps,
            inference_fps=frame_result.fps,
            total_detections=self._cumulative_detections,
            active_tracks=frame_result.active_tracks,
            estimated_queue=total_queue,
            traffic_density=round(avg_density, 3),
            frame_number=frame_result.frame_number,
            approaches=list(approach_metrics.values()),
        )
