"use client";

import { useState } from "react";
import RetailPilotAccessPanel from "./RetailPilotAccessPanel";
import RetailStreamPlayoutPanel from "./RetailStreamPlayoutPanel";

export default function RetailStreamProgrammePanels({ organisationId }) {
  const [accessRevision, setAccessRevision] = useState(0);
  return <>
    <RetailPilotAccessPanel organisationId={organisationId} onAccessChanged={() => setAccessRevision(previous => previous + 1)} />
    <RetailStreamPlayoutPanel organisationId={organisationId} accessRevision={accessRevision} />
  </>;
}
