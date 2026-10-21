import test from "node:test";
import assert from "node:assert/strict";
import { runAccountedRotation } from "../lib/online-radio-accounted-runner.mjs";
import { createOnlineRadioDeliveryLedger, senderUsageRows } from "../lib/online-radio-delivery-ledger.mjs";

const entry = id => ({ track: { id: `track-${id}`, mediaAsset: { id: `asset-${id}`, durationSeconds: 3 } } });
function fixture(overrides = {}) {
  const rows = new Map(), observations = [], resources = [], calls = { prepared: 0, connected: 0, played: 0, disposed: 0 };
  const ledger = createOnlineRadioDeliveryLedger({ identity: { organisationId: "org-1", stationId: "station-1", destinationId: "source-1", sessionId: "session-1" },
    prisma: { auditLog: { upsert: async ({ where, create }) => {
      if (!rows.has(where.id)) rows.set(where.id, create);
      return rows.get(where.id);
    } } } });
  const options = {
    entries: [entry(1), entry(2)], ledger, maxSegments: 3, guardIntervalMs: 10, guardTimeoutMs: 30,
    loadApproval: async () => ({ allowed: true, approvedUntil: new Date(Date.now() + 30000) }),
    renewLease: async () => true,
    prepareAudio: async () => { calls.prepared++; return { dispose: async () => { calls.disposed++; } }; },
    connectSource: async ({ registerResource }) => {
      calls.connected++;
      const resource = { closed: false, forceClose() { this.closed = true; }, async close() { this.closed = true; return { closed: true }; } };
      resources.push(resource); registerResource(resource); return { authenticated: true };
    },
    playTrack: async ({ entry, emit }) => {
      assert.equal([...rows.values()].at(-1).details.event.type, "STARTED", "reservation is durable before audio");
      calls.played++; observations.push(entry.track.id);
      await emit({ audioBytesSent: 417, encodedSecondsSent: 1152 / 44100 });
      await emit({ audioBytesSent: 834, encodedSecondsSent: 2304 / 44100 });
      return { completed: true, audioBytesSent: 834, encodedSecondsSent: 2304 / 44100 };
    }, ...overrides
  };
  return { options, calls, rows, ledger, resources, observations, events: () => [...rows.values()].map(row => row.details.event) };
}

test("accounted rotation reuses one source, records real observations and repeated occurrences separately", async () => {
  const f = fixture(); const result = await runAccountedRotation(f.options);
  assert.equal(result.status, "COMPLETE"); assert.equal(result.endedSegments, 3);
  assert.equal(result.stopConfirmed, true); assert.equal(result.quarantined, false);
  assert.deepEqual(f.observations, ["track-1", "track-2", "track-1"]);
  assert.equal(f.calls.connected, 1); assert.equal(f.calls.disposed, 1);
  assert.deepEqual(f.events().map(event => event.type), ["STARTED", "AUDIO_SENT", "ENDED", "STARTED", "AUDIO_SENT", "ENDED", "STARTED", "AUDIO_SENT", "ENDED"]);
  assert.deepEqual(f.events().filter(e => e.type === "ENDED").map(e => e.segmentSequence), [1, 2, 3]);
  const report = senderUsageRows(f.events());
  assert.equal(report.find(row => row.trackId === "track-1").observedTransmittedBytes, 1668);
  assert.ok(report.every(row => row.listenerProof === false && row.royaltyConfirmed === false));
});

test("a denied entitlement/rights approval or unavailable lease cannot reach preparation or connection", async () => {
  for (const change of [{ loadApproval: async () => ({ allowed: false }) }, { renewLease: async () => false }]) {
    const f = fixture(change); const result = await runAccountedRotation(f.options);
    assert.equal(result.status, "STOPPED"); assert.equal(f.calls.prepared, 0); assert.equal(f.calls.connected, 0);
    assert.equal(f.events().length, 0);
  }
});

test("a failed durable STARTED write permits no audio and quarantines the run", async () => {
  const f = fixture();
  f.options.ledger = { record: async () => { throw new Error("private database detail"); }, drain: async () => {} };
  const result = await runAccountedRotation(f.options);
  assert.equal(result.quarantined, true); assert.equal(result.reasonCode, "DELIVERY_RECORD_FAILED");
  assert.equal(f.calls.played, 0); assert.ok(f.resources.every(r => r.closed));
});

test("failed first-audio accounting closes the source and leaves an unknown reservation", async () => {
  const f = fixture();
  f.options.ledger = { record: event => event.type === "AUDIO_SENT" ? Promise.reject(new Error("unavailable")) : f.ledger.record(event), drain: () => f.ledger.drain() };
  const result = await runAccountedRotation(f.options);
  assert.equal(result.quarantined, true); assert.equal(result.endedSegments, 0);
  assert.deepEqual(f.events().map(event => event.type), ["STARTED"]);
  assert.equal(senderUsageRows(f.events())[0].sourceCompletionStatus, "UNKNOWN");
});

test("rights withdrawal or lease loss interrupts an in-flight track without a completed event", async () => {
  for (const reason of ["rights", "lease"]) {
    let revoked = false;
    const f = fixture({ maxSegments: 1,
      loadApproval: async () => ({ allowed: !(revoked && reason === "rights"), approvedUntil: new Date(Date.now() + 30000) }),
      renewLease: async () => !(revoked && reason === "lease"),
      playTrack: async ({ emit, signal }) => {
        await emit({ audioBytesSent: 417, encodedSecondsSent: 1152 / 44100 }); revoked = true;
        await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
        return { completed: true, audioBytesSent: 417, encodedSecondsSent: 1152 / 44100 };
      }
    });
    const result = await runAccountedRotation(f.options);
    assert.equal(result.endedSegments, 0); assert.equal(result.stopConfirmed, true);
    assert.equal(f.events().at(-1).type, "INTERRUPTED");
    assert.equal(f.events().at(-1).reasonCode, reason === "rights" ? "RIGHTS_REVOKED" : "LEASE_LOST");
    assert.equal(f.events().at(-1).transmittedBytes, 417);
  }
});

test("a hanging approval request interrupts in-flight audio within the bounded guard and quarantines uncertain closure", { timeout: 5000 }, async () => {
  for (const confirmsClose of [true, false]) {
    let playing = false, hangingApprovalCalls = 0, forcedCloses = 0, abortedAt = null;
    const f = fixture({ maxSegments: 1, guardIntervalMs: 10, guardTimeoutMs: 30,
      loadApproval: async () => {
        if (playing) { hangingApprovalCalls += 1; return new Promise(() => {}); }
        return { allowed: true, approvedUntil: new Date(Date.now() + 30000) };
      },
      connectSource: async ({ registerResource }) => {
        registerResource({ forceClose() { forcedCloses += 1; }, async close() { return { closed: confirmsClose }; } });
        return { authenticated: true };
      },
      playTrack: async ({ emit, signal }) => {
        await emit({ audioBytesSent: 417, encodedSecondsSent: 1152 / 44100 });
        playing = true;
        await new Promise(resolve => signal.addEventListener("abort", () => { abortedAt = performance.now(); resolve(); }, { once: true }));
        return { completed: true, audioBytesSent: 417, encodedSecondsSent: 1152 / 44100 };
      }
    });
    const started = performance.now(), result = await runAccountedRotation(f.options);
    assert.ok(hangingApprovalCalls > 0, "a real in-flight approval request was left unresolved");
    assert.ok(abortedAt !== null && abortedAt - started < 1500, "independent timeout interrupts the sender without waiting for approval resolution");
    assert.ok(performance.now() - started < 2000);
    assert.ok(forcedCloses > 0); assert.equal(result.endedSegments, 0);
    assert.equal(result.stopConfirmed, confirmsClose); assert.equal(result.quarantined, !confirmsClose);
    assert.equal(result.status, confirmsClose ? "STOPPED" : "FAILED");
    assert.equal(f.events().at(-1).type, "INTERRUPTED");
    assert.equal(f.events().at(-1).reasonCode, "RIGHTS_REVOKED");
    assert.equal(f.events().at(-1).transmittedBytes, 417);
    assert.equal(f.calls.disposed, confirmsClose ? 1 : 0, "uncertain source closure retains cached files");
    assert.equal(f.events().some(event => event.type === "ENDED"), false);
  }
});

test("an absolute approval deadline stops a track even between approval polls", async () => {
  const deadline = new Date(Date.now() + 80);
  const f = fixture({ guardIntervalMs: 1000, maxSegments: 1,
    loadApproval: async () => ({ allowed: true, approvedUntil: deadline }),
    playTrack: async ({ emit, signal }) => { await emit({ audioBytesSent: 417, encodedSecondsSent: 0.02 }); await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })); }
  });
  const result = await runAccountedRotation(f.options);
  assert.equal(result.reasonCode, "RIGHTS_REVOKED"); assert.equal(result.endedSegments, 0);
});

test("parent shutdown closes resources and records partial transmission, not natural EOF", async () => {
  const parent = new AbortController();
  const f = fixture({ signal: parent.signal, maxSegments: 1,
    playTrack: async ({ emit }) => { await emit({ audioBytesSent: 417, encodedSecondsSent: 0.02 }); parent.abort(); return { completed: true, audioBytesSent: 417, encodedSecondsSent: 0.02 }; }
  });
  const result = await runAccountedRotation(f.options);
  assert.equal(result.endedSegments, 0); assert.equal(f.events().at(-1).reasonCode, "SHUTDOWN");
  assert.ok(f.resources.every(resource => resource.closed));
});

test("an unconfirmed close retains files and requests quarantine", async () => {
  const f = fixture({ maxSegments: 1,
    connectSource: async ({ registerResource }) => { registerResource({ forceClose() {}, close: async () => ({ closed: false }) }); return { authenticated: true }; }
  });
  const result = await runAccountedRotation(f.options);
  assert.equal(result.stopConfirmed, false); assert.equal(result.quarantined, true); assert.equal(f.calls.disposed, 0);
  assert.equal(result.status, "FAILED");
});

test("a failed final accounting drain is failed and quarantined even after a natural track end", async () => {
  const f = fixture({ maxSegments: 1 });
  f.options.ledger = { record: event => f.ledger.record(event), drain: async () => { throw new Error("late acknowledgement unavailable"); } };
  const result = await runAccountedRotation(f.options);
  assert.equal(result.endedSegments, 1); assert.equal(result.status, "FAILED");
  assert.equal(result.reasonCode, "DELIVERY_RECORD_FAILED"); assert.equal(result.quarantined, true);
});

test("unregistered closed decoders keep long runs bounded", async () => {
  const f = fixture({ maxSegments: 80,
    playTrack: async ({ emit, registerResource }) => {
      const unregister = registerResource({ forceClose() {}, close: async () => ({ closed: true }) });
      await emit({ audioBytesSent: 417, encodedSecondsSent: 0.02 }); unregister();
      return { completed: true, audioBytesSent: 417, encodedSecondsSent: 0.02 };
    }
  });
  const result = await runAccountedRotation(f.options);
  assert.equal(result.endedSegments, 80); assert.equal(result.quarantined, false);
});
