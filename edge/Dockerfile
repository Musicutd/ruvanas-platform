FROM node:22-alpine
WORKDIR /opt/ruvanas
RUN addgroup -S ruvanas && adduser -S -G ruvanas ruvanas
COPY --chown=ruvanas:ruvanas edge/ ./edge/
COPY --chown=ruvanas:ruvanas \
  lib/corrections-edge-canonical.mjs \
  lib/corrections-edge-attestation.mjs \
  lib/corrections-edge-manifest.mjs \
  lib/corrections-edge-player-grant.mjs \
  lib/corrections-edge-proof.mjs \
  lib/corrections-c6-policy.mjs \
  lib/corrections-network-policy.mjs \
  lib/opening-hours.mjs ./lib/
USER ruvanas
RUN node --check edge/run.mjs && \
    node --input-type=module -e "await Promise.all([import('./edge/server.mjs'), import('./edge/sync-client.mjs')])"
EXPOSE 8443
CMD ["node", "edge/run.mjs"]
