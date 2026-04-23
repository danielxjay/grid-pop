import { MAINTENANCE_COPY } from "./maintenance.js";

export default function MaintenancePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background:
          "radial-gradient(circle at 18% 18%, rgba(255, 174, 206, 0.3) 0%, transparent 34%), radial-gradient(circle at 82% 14%, rgba(108, 216, 248, 0.24) 0%, transparent 30%), linear-gradient(160deg, #150f26 0%, #1e1635 38%, #101a2e 100%)",
        color: "#fff7fb",
        fontFamily: '"Press Start 2P", monospace',
      }}
    >
      <section
        style={{
          width: "min(720px, 100%)",
          padding: "28px 24px",
          borderRadius: "28px",
          border: "2px solid rgba(145, 242, 255, 0.28)",
          background: "linear-gradient(180deg, rgba(21, 28, 49, 0.92) 0%, rgba(13, 16, 31, 0.94) 100%)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "18px",
            padding: "8px 12px",
            borderRadius: "999px",
            background: "rgba(255, 255, 255, 0.08)",
            color: "#91f2ff",
            fontSize: "10px",
            lineHeight: 1.5,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: "#ffd25e",
              boxShadow: "0 0 14px rgba(255, 210, 94, 0.85)",
            }}
          />
          {MAINTENANCE_COPY.eyebrow}
        </div>

        <h1
          style={{
            margin: "0 0 18px",
            fontSize: "clamp(22px, 4vw, 38px)",
            lineHeight: 1.3,
            color: "#ffffff",
            textShadow: "0 0 18px rgba(145, 242, 255, 0.2)",
          }}
        >
          {MAINTENANCE_COPY.title}
        </h1>

        <p
          style={{
            margin: "0 0 18px",
            fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
            fontSize: "16px",
            lineHeight: 1.7,
            letterSpacing: "0.01em",
            color: "rgba(245, 246, 255, 0.9)",
          }}
        >
          {MAINTENANCE_COPY.body}
        </p>

        <p
          style={{
            margin: "0 0 28px",
            fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
            fontSize: "14px",
            lineHeight: 1.7,
            color: "rgba(198, 207, 235, 0.82)",
          }}
        >
          {MAINTENANCE_COPY.note}
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            appearance: "none",
            border: "0",
            borderRadius: "16px",
            padding: "14px 18px",
            background: "linear-gradient(135deg, #84f0ff 0%, #67d5ff 100%)",
            color: "#12203f",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "11px",
            cursor: "pointer",
            boxShadow: "0 14px 26px rgba(103, 213, 255, 0.28)",
          }}
        >
          Refresh
        </button>
      </section>
    </main>
  );
}
