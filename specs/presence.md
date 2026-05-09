$(cat << 'EOF'
# Presence Tracker Spec
See Leo's design at specs/presence.md in the repo or the Telegram message.
EOF
)

# Generate device auth keys
python3 << 'GEN'
import secrets, json

devices = ["phone", "pc", "fire_tv", "google_tv", "bedroom_lamp"]
keys = {}
for d in devices:
    key = secrets.token_urlsafe(24)
    keys[d] = key
    print(f'{d:15s}: {key}')

# Save to config
with open('/root/.openclaw/openclaw.json', 'r') as f:
    config = json.load(f)
if 'env' not in config: config['env'] = {}
config['env']['DEVICE_KEYS'] = json.dumps(keys)
with open('/root/.openclaw/openclaw.json', 'w') as f:
    json.dump(config, f, indent=2)
print('\n✅ Keys saved to config')
GEN
