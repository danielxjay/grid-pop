import { MAINTENANCE_COPY } from "./maintenance.js";

export default function MaintenancePage() {
  return (
    <div className="maintenance-page">
      <h1>GridPop!</h1>
      <div className="maintenance-card">
        <p className="maintenance-eyebrow">{MAINTENANCE_COPY.eyebrow}</p>
        <h2 className="maintenance-title">{MAINTENANCE_COPY.title}</h2>
        <p className="maintenance-body">{MAINTENANCE_COPY.body}</p>
        <p className="maintenance-note">{MAINTENANCE_COPY.note}</p>
        <button
          className="start-button"
          type="button"
          onClick={() => window.location.reload()}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
