import { validateStudioIsolatedTestTarget } from "../lib/studio-isolated-test-target.mjs";

try {
  validateStudioIsolatedTestTarget({
    acknowledgement: process.env.STUDIO_TEST_ACK,
    testListenerUrl: process.env.STUDIO_TEST_LISTENER_URL,
    testSourceHost: process.env.STUDIO_TEST_SOURCE_HOST,
    testSourcePort: process.env.STUDIO_TEST_SOURCE_PORT,
    productionListenerUrl: process.env.STUDIO_PRODUCTION_LISTENER_URL,
    productionSourceHost: process.env.STUDIO_PRODUCTION_SOURCE_HOST,
    productionSourcePort: process.env.STUDIO_PRODUCTION_SOURCE_PORT
  });
  console.log("Isolated target check passed. No audio was sent or verified.");
} catch (error) {
  // Never print URLs or credentials supplied through the environment.
  console.error(`Isolated target check failed: ${error.message}`);
  process.exitCode = 1;
}
