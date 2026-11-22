import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ConnectedShopperDashboard from "../../app/rewards/ConnectedShopperDashboard";

// Only compiled by the owned loopback integration harness. Production routes
// obtain their initial data through the authenticated server loader instead.
function App() {
  const [data, setData] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/rewards/discovery/locations", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(response => response.json()).then(value => { if (!value.ok) throw Error("Shopper access unavailable"); setData(value); })
      .catch(problem => { if (problem.name !== "AbortError") setError("Local shopper access unavailable."); });
    return () => controller.abort();
  }, []);
  return <><div className="preview-safety"><strong>LOCAL INTEGRATION TEST</strong> · Synthetic shop and shopper accounts · No real purchases</div>
    {data ? <ConnectedShopperDashboard initialData={data} enableSignOut={false} enableClaims /> : <p role="status">{error || "Opening the local shopper workspace…"}</p>}
  </>;
}
createRoot(document.getElementById("root")).render(<App />);
