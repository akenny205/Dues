import { ImageResponse } from "next/og";

// iOS/iPadOS home-screen icon — same mark as icon.tsx, scaled up. Apple
// applies its own corner-rounding mask, so this ships as a full square.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1f4739",
        }}
      >
        <div
          style={{
            width: 118,
            height: 83,
            background: "#f7f6f2",
            borderRadius: 14,
            display: "flex",
            flexDirection: "column",
            transform: "rotate(-8deg)",
          }}
        >
          <div
            style={{
              marginTop: 20,
              width: "100%",
              height: 17,
              background: "#15332a",
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
