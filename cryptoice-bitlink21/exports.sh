#!/bin/bash

# BitLink21 v2.0.0 — Single container, no static IPs needed

# PlutoSDR hardware — default URI, user can change via UI settings
export APP_CRYPTOICE_BITLINK21_PLUTO_URI="ip:192.168.1.200"

# Bitcoin/Lightning (optional — leave empty to disable)
export APP_CRYPTOICE_BITLINK21_BITCOIN_RPC_URL=""
export APP_CRYPTOICE_BITLINK21_BITCOIN_RPC_USER=""
export APP_CRYPTOICE_BITLINK21_BITCOIN_RPC_PASS=""
export APP_CRYPTOICE_BITLINK21_LND_REST_URL=""
