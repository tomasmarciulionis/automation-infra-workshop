#!/usr/bin/env bash
#
# Linux preflight: installs Java 17, Node 22 and Google Chrome, then runs the
# repo setup and environment check.
#
# Supports Debian/Ubuntu (apt) and Fedora/RHEL (dnf).
#
# Run BEFORE the workshop, on good wifi:
#   bash scripts/preflight-linux.sh
#
# Safe to re-run: every step is skipped if already satisfied.

set -euo pipefail

JAVA_VERSION="17"
NODE_MAJOR="22"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m  ok\033[0m   %s\n' "$1"; }
info() { printf '\033[2m  ..\033[0m   %s\n' "$1"; }
warn() { printf '\033[33m  warn\033[0m %s\n' "$1"; }
die()  { printf '\033[31m  FAIL\033[0m %s\n' "$1" >&2; exit 1; }

cd "$(dirname "$0")/.."

if command -v apt-get >/dev/null 2>&1; then
  PM="apt"
elif command -v dnf >/dev/null 2>&1; then
  PM="dnf"
else
  die "Neither apt-get nor dnf found. Install Java ${JAVA_VERSION}, Node ${NODE_MAJOR} and Chrome manually, then run: npm ci && npm run setup"
fi
info "package manager: ${PM}"

bold "1/4  Java ${JAVA_VERSION} (needed only because the Grid hub and nodes are Java processes)"
current_java_major=""
if command -v java >/dev/null 2>&1; then
  current_java_major="$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/')"
fi

if [ -n "$current_java_major" ] && [ "$current_java_major" -ge 11 ] 2>/dev/null; then
  ok "Java ${current_java_major} already on PATH (11+ is enough)"
else
  if [ "$PM" = "apt" ]; then
    sudo apt-get update
    sudo apt-get install -y "openjdk-${JAVA_VERSION}-jdk-headless"
  else
    sudo dnf install -y "java-${JAVA_VERSION}-openjdk-headless"
  fi
  ok "$(java -version 2>&1 | head -1)"
fi

bold "2/4  Node.js ${NODE_MAJOR}"
current_node_major=""
if command -v node >/dev/null 2>&1; then
  current_node_major="$(node -v | sed -E 's/v([0-9]+).*/\1/')"
fi

if [ -n "$current_node_major" ] && [ "$current_node_major" -ge 20 ] 2>/dev/null; then
  ok "Node $(node -v) already installed (20+ is enough)"
else
  # Distro repos often ship a Node too old for us, so use NodeSource.
  info "adding the NodeSource repository for Node ${NODE_MAJOR}"
  if [ "$PM" = "apt" ]; then
    sudo apt-get install -y curl ca-certificates
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo dnf install -y nodejs
  fi
  ok "Node $(node -v)"
fi

bold "3/4  Google Chrome"
if command -v google-chrome >/dev/null 2>&1 || command -v google-chrome-stable >/dev/null 2>&1; then
  ok "already installed"
elif command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then
  ok "Chromium found (works too)"
else
  info "installing Google Chrome"
  if [ "$PM" = "apt" ]; then
    tmp_deb="$(mktemp --suffix=.deb)"
    curl -fsSL -o "$tmp_deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    sudo apt-get install -y "$tmp_deb"
    rm -f "$tmp_deb"
  else
    sudo dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
  fi
  ok "installed"
fi

# Headless Chrome on a minimal Linux image is missing shared libraries that
# Playwright and chromedriver both need. This pulls them in.
bold "3b/4  Chrome shared libraries"
if [ "$PM" = "apt" ]; then
  sudo apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2t64 2>/dev/null \
    || sudo apt-get install -y libasound2 2>/dev/null \
    || warn "some optional libraries were unavailable - continue and see if Chrome starts"
else
  sudo dnf install -y nss atk at-spi2-atk cups-libs libdrm libxkbcommon \
    libXcomposite libXdamage libXfixes libXrandr mesa-libgbm pango cairo alsa-lib \
    || warn "some optional libraries were unavailable - continue and see if Chrome starts"
fi
ok "done"

bold "4/4  Project dependencies and tooling"
info "npm ci"
npm ci
info "npm run setup (downloads the Selenium jar, Prometheus and Chromium)"
npm run setup

echo
bold "Preflight done - running the environment check"
npm run doctor
