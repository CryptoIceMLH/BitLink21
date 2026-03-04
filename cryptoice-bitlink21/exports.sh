#!/bin/bash

# Static IPs on the Umbrel network
# Using 10.21.22.x range to avoid collision with Prometheus (10.21.21.x)
export APP_CRYPTOICE_BITLINK21_RADIO_IP="10.21.22.2"
export APP_CRYPTOICE_BITLINK21_CORE_IP="10.21.22.3"

# Ports
export APP_CRYPTOICE_BITLINK21_API_PORT="8021"
export APP_CRYPTOICE_BITLINK21_WS_PORT="40134"

# PlutoSDR hardware — default URI, user can change via UI settings
export APP_CRYPTOICE_BITLINK21_PLUTO_URI="ip:192.168.1.200"

# API token — generate once, persist in .env
BITLINK_ENV_FILE="${EXPORTS_APP_DIR}/.env"

if [[ ! -f "${BITLINK_ENV_FILE}" ]]; then
	BITLINK_API_TOKEN=$(openssl rand -hex 32)
	echo "export APP_CRYPTOICE_BITLINK21_API_TOKEN='${BITLINK_API_TOKEN}'" >> "${BITLINK_ENV_FILE}"
fi

. "${BITLINK_ENV_FILE}"
