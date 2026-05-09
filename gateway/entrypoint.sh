#!/bin/sh
set -e

# Ensure Tailscale state directory exists
mkdir -p /var/lib/tailscale

# Start Tailscale daemon
tailscaled --state=/var/lib/tailscale/tailscaled.state &
sleep 2

# Join the tailnet
tailscale up --auth-key=${TAILSCALE_AUTH_KEY}

# Expose via Tailscale Serve
tailscale serve --bg --https=443 4000

# Start Caddy in the foreground
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
