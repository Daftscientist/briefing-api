#!/bin/sh
set -e

# Install Tailscale
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# Start Tailscale
tailscaled --state=/var/lib/tailscale/tailscaled.state &
sleep 2

# Join the tailnet with the auth key
# State is persisted in the volume, so the machine name stays consistent
tailscale up --auth-key=${TAILSCALE_AUTH_KEY}

# Expose this container's Caddy via Tailscale Serve
# Tailscale provides a valid Let's Encrypt cert for *.tail53f5e9.ts.net
tailscale serve --bg --https=443 4000

# Start Caddy in the foreground
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
