import { ImageResponse } from "next/og";

// Browser tab / bookmark icon — a tilted card with a stripe, standing in
// for "transactions," on the brand accent green. Flat geometric shapes
// (no text) so it stays legible down at 16px.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        <div
          style={{
            width: 21,
            height: 15,
            background: "#f7f6f2",
            borderRadius: 3,
            display: "flex",
            flexDirection: "column",
            transform: "rotate(-8deg)",
          }}
        >
          <div
            style={{
              marginTop: 4,
              width: "100%",
              height: 3,
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
