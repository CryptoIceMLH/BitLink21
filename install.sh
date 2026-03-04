#!/usr/bin/env bash
set -e

# BitLink21 Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/CryptoIceMLH/BitLink21/master/install.sh | bash

INSTALL_DIR="$HOME/bitlink21"
REPO_URL="https://github.com/CryptoIceMLH/BitLink21"
BRANCH="master"

echo "======================================="
echo " BitLink21 Installer"
echo " Bitcoin Satellite Communication Layer"
echo "======================================="
echo ""

# Check dependencies
command -v docker >/dev/null 2>&1 || { echo "Error: Docker not installed. Install from https://docs.docker.com/get-docker/"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "Error: git not installed."; exit 1; }

echo "Creating install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Existing install found, pulling latest..."
    cd "$INSTALL_DIR"
    git pull origin "$BRANCH"
else
    echo "Cloning BitLink21..."
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Create data directories
mkdir -p data/radio data/core

echo ""
echo "Building and starting BitLink21..."
docker compose pull 2>/dev/null || true
docker compose up -d --build

echo ""
echo "======================================="
echo " BitLink21 started!"
echo ""
echo " Web UI:  http://localhost:3000"
echo " API:     http://localhost:8021/api/v1/health"
echo " Radio:   ws://localhost:40134"
echo ""
echo " To stop:    cd $INSTALL_DIR && docker compose down"
echo " To update:  cd $INSTALL_DIR && git pull && docker compose up -d --build"
echo "======================================="
