#!/bin/bash
# BitLink21 Dev Server Setup Script
# Run on: Ubuntu 22.04 LTS (bitlink21@192.168.1.114)
# Usage: bash server-setup.sh

set -e  # Exit on error

echo "=========================================="
echo "BitLink21 Dev Server Setup"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. System Updates
echo -e "${YELLOW}[1/7] Updating system packages...${NC}"
sudo apt-get update
sudo apt-get upgrade -y
echo -e "${GREEN}✓ System updated${NC}"
echo ""

# 2. Build Tools & Essentials
echo -e "${YELLOW}[2/7] Installing build tools...${NC}"
sudo apt-get install -y \
  build-essential \
  cmake \
  git \
  wget \
  curl \
  pkg-config \
  autoconf \
  automake \
  libtool \
  bison \
  flex
echo -e "${GREEN}✓ Build tools installed${NC}"
echo ""

# 3. DSP & Radio Libraries
echo -e "${YELLOW}[3/7] Installing DSP and radio libraries...${NC}"
sudo apt-get install -y \
  libfftw3-dev \
  libopus-dev \
  libcodec2-dev \
  libsndfile-dev \
  libasound-dev \
  libusb-1.0-0-dev \
  libxml2-dev
echo -e "${GREEN}✓ DSP libraries installed${NC}"
echo ""

# 4. IIO & SDR Stack
echo -e "${YELLOW}[4/7] Installing libiio and libad9361...${NC}"
sudo apt-get install -y \
  libiio-dev \
  libad9361-dev
echo -e "${GREEN}✓ IIO/SDR libraries installed${NC}"
echo ""

# 5. Docker & Docker Compose
echo -e "${YELLOW}[5/7] Installing Docker & Docker Compose...${NC}"
curl -fsSL https://get.docker.com -o get-docker.sh
sudo bash get-docker.sh
sudo usermod -aG docker $(whoami)
sudo apt-get install -y docker-compose
rm get-docker.sh
echo -e "${GREEN}✓ Docker installed${NC}"
echo ""

# 6. Python 3 & Dev Tools
echo -e "${YELLOW}[6/7] Installing Python 3 and development tools...${NC}"
sudo apt-get install -y \
  python3 \
  python3-pip \
  python3-venv \
  python3-dev
echo -e "${GREEN}✓ Python 3 installed${NC}"
echo ""

# 7. Project Directory Setup
echo -e "${YELLOW}[7/7] Creating project directory structure...${NC}"
mkdir -p ~/bitlink21/{radio/src,core/src,web-ui/src}
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo -e "${GREEN}✓ Project directories created at ~/bitlink21${NC}"
echo ""

echo "=========================================="
echo -e "${GREEN}✓ Server setup complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Generate SSH key: ssh-keygen -t ed25519 -C 'bitlink21'"
echo "2. Add public key to GitHub: https://github.com/settings/keys"
echo "3. Clone repo: git clone git@github.com:CryptoIceMLH/BitLink21.git ~/bitlink21"
echo "4. Verify Docker: docker --version && docker compose version"
echo ""
