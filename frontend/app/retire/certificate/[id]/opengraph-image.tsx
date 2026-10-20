import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Retirement certificate";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: { id: string };
}) {
  const id = params?.id ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0b3d2e 0%, #14532d 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
          padding: "64px",
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: 4, opacity: 0.8 }}>
          RETIREMENT CERTIFICATE
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            marginTop: 24,
            textAlign: "center",
          }}
        >
          Carbon Retirement
        </div>
        <div style={{ fontSize: 24, marginTop: 32, opacity: 0.7 }}>
          Certificate #{id}
        </div>
      </div>
    ),
    { ...size }
  );
}
