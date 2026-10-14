// ---------------------------------------------------------------------------
// GREENWAVE — road-network domain types (OSM-derived static graph)
//
// Coordinates are geographic: [latitude, longitude] everywhere. The UI
// renders the graph through a static projection (see src/utils/geo.ts +
// src/data/osmRoadNetwork.ts), never by mutating these records.
// ---------------------------------------------------------------------------

export type CongestionLevel = 'NORMAL' | 'MODERATE' | 'HEAVY' | 'CRITICAL'

export interface Intersection {
  id: string
  /** junction name from incident OSM street names, e.g. "Cambridge Street / Blossom Street" */
  name?: string
  lat: number
  lng: number
  /** true when the junction carries a real signal head */
  signalized: boolean
}

export interface RoadSegment {
  id: string
  from: string
  to: string
  name?: string
  /** full polyline geometry, [lat, lng] pairs (bends included) */
  coordinates: [number, number][]
  /** metres (haversine over the geometry) */
  length: number
  roadType: string
  /** km/h free-flow */
  speedLimit: number
  lanes: number
  /** 0..1 base congestion — drives segment colouring and routing cost */
  congestion: number
  vehicleCount?: number
  queueLength?: number
}

export interface RoadNetwork {
  intersections: Intersection[]
  roads: RoadSegment[]
}

/** OSM polygon scenery attached to the network (parks, water, hospital campuses) */
export interface ScenePolygon {
  kind: 'park' | 'water' | 'campus'
  name?: string
  /** closed ring, [lat, lng] pairs */
  coordinates: [number, number][]
  centroid?: [number, number]
}

/** domain emergency record — dispatch lifecycle lives on the runtime type */
export interface Emergency {
  id: string
  type: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  originIntersectionId: string
  destinationIntersectionId: string
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED'
}

/** raw planner output (cost model: length * (1 + congestionScore)) */
export interface RouteResult {
  roadIds: string[]
  intersectionIds: string[]
  /** metres */
  totalDistance: number
  /** seconds — baseline (congested) travel estimate including signal holds */
  estimatedTravelTime: number
}
