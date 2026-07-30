"use client";

import { useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L, { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import ErrorBoundary from "./ErrorBoundary";
import MapFallbackTable from "./MapFallbackTable";
import { formatTonnes } from "../lib/carbon-utils";
import { getProjectTypeColor, MapPin } from "../lib/map-utils";

// Fix for default markers in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

/** Small colored circle marker, used to color-code pins by projectType. */
function createColoredIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "project-map-pin",
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.6);"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
}

interface SingleMarkerProps {
  latitude: number;
  longitude: number;
  projectName: string;
  pins?: undefined;
}

interface ClusteredMapProps {
  pins: MapPin[];
  latitude?: undefined;
  longitude?: undefined;
  projectName?: undefined;
}

type ProjectMapProps = SingleMarkerProps | ClusteredMapProps;

function ClusteredMap({ pins }: { pins: MapPin[] }) {
  if (pins.length === 0) {
    return (
      <div
        style={{
          height: "420px",
          width: "100%",
          borderRadius: "0.75rem",
          border: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6b7280",
          fontSize: "0.875rem",
          background: "#f9fafb",
        }}
        role="status"
      >
        No projects match the current filters.
      </div>
    );
  }

  const defaultCenter: LatLngExpression = [pins[0].lat, pins[0].lng];

  return (
    <div style={{ height: "420px", width: "100%", borderRadius: "0.75rem", overflow: "hidden" }}>
      <MapContainer center={defaultCenter} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <MarkerClusterGroup chunkedLoading>
          {pins.map((pin) => (
            <Marker
              key={pin.listingId}
              position={[pin.lat, pin.lng]}
              icon={createColoredIcon(getProjectTypeColor(pin.projectType))}
              keyboard
              title={`${pin.projectName}, ${pin.projectType}, ${pin.country}`}
            >
              <Popup>
                <div style={{ minWidth: "180px" }}>
                  <p style={{ fontWeight: 700, margin: "0 0 0.25rem", fontSize: "0.9rem" }}>{pin.projectName}</p>
                  <p style={{ fontSize: "0.8rem", color: "#4b5563", margin: "0 0 0.15rem" }}>
                    {pin.vintageYear} Vintage · {pin.projectType}
                  </p>
                  <p style={{ fontSize: "0.8rem", color: "#4b5563", margin: "0 0 0.15rem" }}>
                    Methodology score: {pin.methodologyScore}/100
                  </p>
                  <p style={{ fontSize: "0.8rem", color: "#4b5563", margin: "0 0 0.6rem" }}>
                    {formatTonnes(pin.amountAvailable)} available
                  </p>
                  <a
                    href={`/projects/${pin.projectId}`}
                    style={{
                      display: "inline-block",
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      borderRadius: "0.375rem",
                      background: "#16a34a",
                      color: "#fff",
                      textDecoration: "none",
                    }}
                  >
                    View Details
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}

/**
 * ProjectMap renders either:
 *  - a single project marker (original behavior — pass latitude,
 *    longitude, projectName; used by the project detail page), or
 *  - a clustered multi-project map (pass `pins`; used by the
 *    marketplace page), with pins color-coded by projectType,
 *    click-to-view popovers, and a table-view toggle.
 *
 * Accessibility note: Leaflet markers are keyboard-focusable and
 * Enter/Space-activatable by default (no extra wiring needed for
 * that part). Their accessible name comes from the marker's `title`
 * attribute, which is a reasonable but imperfect signal for screen
 * readers on a densely clustered map. The "Table view" toggle below
 * renders the same pins as a real <table>, which is the more
 * reliable accessible path — offered as a first-class alternative
 * view, not just an error fallback.
 */
export default function ProjectMap(props: ProjectMapProps) {
  const [view, setView] = useState<"map" | "table">("map");

  if (props.pins === undefined) {
    // Legacy single-marker mode — unchanged from the original implementation.
    const { latitude, longitude, projectName } = props;
    const position: LatLngExpression = [latitude, longitude];

    return (
      <div style={{ height: "300px", width: "100%", borderRadius: "0.75rem", overflow: "hidden" }}>
        <MapContainer center={position} zoom={10} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <Marker position={position}>
            <Popup>{projectName}</Popup>
          </Marker>
        </MapContainer>
      </div>
    );
  }

  const { pins } = props;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button
          type="button"
          onClick={() => setView((v) => (v === "map" ? "table" : "map"))}
          aria-pressed={view === "table"}
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            padding: "0.4rem 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid #d1d5db",
            background: "#fff",
            color: "#374151",
            cursor: "pointer",
          }}
        >
          {view === "map" ? "Switch to table view" : "Switch to map view"}
        </button>
      </div>

      {view === "table" ? (
        <MapFallbackTable pins={pins} />
      ) : (
        <ErrorBoundary fallback={<MapFallbackTable pins={pins} />}>
          <ClusteredMap pins={pins} />
        </ErrorBoundary>
      )}
    </div>
  );
}
