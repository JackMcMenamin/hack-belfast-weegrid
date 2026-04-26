"use client";

import { LatLngBounds, LatLngExpression } from "leaflet";
import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

type BuildingMarker = {
  index: number;
  lat: number;
  lon: number;
  selected: boolean;
};

type ClusterMapProps = {
  latitude: number;
  longitude: number;
  hull: [number, number][];
  buildings: BuildingMarker[];
  areaLabel: string;
  reframeKey: string;
  onToggleBuilding?: (index: number) => void;
};

function ReframeMap({
  latitude,
  longitude,
  bounds,
  reframeKey,
}: {
  latitude: number;
  longitude: number;
  bounds: [number, number][];
  reframeKey: string;
}) {
  const map = useMap();

  useEffect(() => {
    if (bounds.length > 1) {
      const latLngBounds = new LatLngBounds(
        bounds.map(([lat, lon]) => [lat, lon] as LatLngExpression),
      );
      map.fitBounds(latLngBounds.pad(0.25), { animate: true });
    } else {
      map.setView([latitude, longitude], 16, { animate: true });
    }
    // We intentionally only re-frame when the cluster identity changes so
    // toggling individual houses doesn't reset the user's pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reframeKey, map]);

  return null;
}

export default function StreetOverviewMap({
  latitude,
  longitude,
  hull,
  buildings,
  areaLabel,
  reframeKey,
  onToggleBuilding,
}: ClusterMapProps) {
  const tileUrl =
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
  const attribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

  const reframeBounds =
    hull.length > 2
      ? hull
      : (buildings
          .filter((building) => building.selected)
          .map(
            (building) => [building.lat, building.lon] as [number, number],
          ) as [number, number][]);

  return (
    <div className="h-[460px] w-full overflow-hidden rounded-2xl border border-white/20">
      <MapContainer
        center={[latitude, longitude]}
        zoom={16}
        scrollWheelZoom
        className="h-full w-full"
      >
        <ReframeMap
          latitude={latitude}
          longitude={longitude}
          bounds={reframeBounds}
          reframeKey={reframeKey}
        />
        <TileLayer attribution={attribution} url={tileUrl} />

        {hull.length > 2 ? (
          <Polygon
            positions={hull}
            pathOptions={{
              color: "#22c55e",
              weight: 2.5,
              opacity: 0.9,
              fillColor: "#22c55e",
              fillOpacity: 0.18,
              className: "co-op-selection-line",
            }}
            interactive={false}
          />
        ) : null}

        {buildings.map((building) => (
          <CircleMarker
            key={building.index}
            center={[building.lat, building.lon]}
            radius={building.selected ? 5 : 4}
            pathOptions={{
              color: building.selected ? "#bbf7d0" : "#475569",
              fillColor: building.selected ? "#22c55e" : "#cbd5f5",
              fillOpacity: building.selected ? 0.95 : 0.6,
              weight: building.selected ? 0.8 : 0.6,
            }}
            eventHandlers={
              onToggleBuilding
                ? {
                    click: () => onToggleBuilding(building.index),
                  }
                : undefined
            }
          >
            {onToggleBuilding ? (
              <Tooltip direction="top" offset={[0, -4]}>
                {building.selected ? "Click to remove" : "Click to add"}
              </Tooltip>
            ) : null}
          </CircleMarker>
        ))}

        <CircleMarker
          center={[latitude, longitude]}
          radius={8}
          pathOptions={{
            color: "#ecfdf5",
            fillColor: "#22c55e",
            fillOpacity: 1,
            weight: 2,
          }}
        >
          <Popup>
            <strong>{areaLabel}</strong>
            <br />
            Suggested co-op cluster center.
          </Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
