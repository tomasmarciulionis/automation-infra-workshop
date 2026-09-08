#!/usr/bin/env bash
#
# macOS preflight: installs Java 17, Node 22 and Google Chrome via Homebrew,
# then runs the repo setup and environment check.
#
# Run BEFORE the workshop, on good wifi:
#   bash scripts/preflight-macos.sh
#
# Safe to re-run: every step is skipped if already satisfied.

set -euo pipefail

JAVA_VERSION="17"
NODE_VERSION="22"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m  ok\033[0m   %s\n' "$1"; }
info() { printf '\033[2m  ..\033[0m   %s\n' "$1"; }
warn() { printf '\033[33m  warn\033[0m %s\n' "$1"; }
die()  { printf '\033[31m  FAIL\033[0m %s\n' "$1" >&2; exit 1; }

cd "$(dirname "$0")/.."

bold "1/5  Homebrew"
if command -v brew >/dev/null 2>&1; then
  ok "already installed ($(brew --version | head -1))"
else
  info "installing Homebrew (you will be prompted for your password)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon installs to /opt/homebrew, Intel to /usr/local.
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  command -v brew >/dev/null 2>&1 || die "Homebrew installed but not on PATH. Open a new terminal and re-run."
fi

bold "2/5  Java ${JAVA_VERSION} (needed only because the Grid hub and nodes are Java processes)"
current_java_major=""
if command -v java >/dev/null 2>&1; then
  current_java_major="$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/')"
fi

if [ -n "$current_java_major" ] && [ "$current_java_major" -ge 11 ] 2>/dev/null; then
  ok "Java ${current_java_major} already on PATH (11+ is enough)"
else
  info "installing openjdk@${JAVA_VERSION}"
  brew install "openjdk@${JAVA_VERSION}"

  # Homebrew's openjdk is keg-only: it is not symlinked onto PATH by default.
  # Registering it with macOS makes `java` work in every new shell, including
  # ones the Grid scripts spawn.
  jdk_prefix="$(brew --prefix "openjdk@${JAVA_VERSION}")"
  info "registering the JDK with macOS (needs sudo, one time)"
  sudo ln -sfn "${jdk_prefix}/libexec/openjdk.jdk" \
    "/Library/Java/JavaVirtualMachines/openjdk-${JAVA_VERSION}.jdk"

  # Also add it to the current shell profile so this terminal works right away.
  shell_rc="${HOME}/.zshrc"
  export_line="export PATH=\"${jdk_prefix}/bin:\$PATH\""
  if ! grep -qF "${jdk_prefix}/bin" "$shell_rc" 2>/dev/null; then
    echo "$export_line" >> "$shell_rc"
    info "added openjdk@${JAVA_VERSION} to ${shell_rc}"
  fi
  export PATH="${jdk_prefix}/bin:$PATH"

  java -version >/dev/null 2>&1 || die "Java still not runnable. Open a new terminal and re-run."
  ok "$(java -version 2>&1 | head -1)"
fi

bold "3/5  Node.js ${NODE_VERSION}"
current_node_major=""
if command -v node >/dev/null 2>&1; then
  current_node_major="$(node -v | sed -E 's/v([0-9]+).*/\1/')"
fi

if [ -n "$current_node_major" ] && [ "$current_node_major" -ge 20 ] 2>/dev/null; then
  ok "Node $(node -v) already installed (20+ is enough)"
else
  info "installing node@${NODE_VERSION}"
  brew install "node@${NODE_VERSION}"
  node_prefix="$(brew --prefix "node@${NODE_VERSION}")"
  shell_rc="${HOME}/.zshrc"
  if ! grep -qF "${node_prefix}/bin" "$shell_rc" 2>/dev/null; then
    echo "export PATH=\"${node_prefix}/bin:\$PATH\"" >> "$shell_rc"
  fi
  export PATH="${node_prefix}/bin:$PATH"
  command -v node >/dev/null 2>&1 || die "Node installed but not on PATH. Open a new terminal and re-run."
  ok "Node $(node -v)"
fi

bold "4/5  Google Chrome"
if [ -d "/Applications/Google Chrome.app" ]; then
  ok "already installed"
else
  info "installing Google Chrome"
  brew install --cask google-chrome
  ok "installed"
fi

bold "5/5  Project dependencies and tooling"
info "npm ci"
npm ci
info "npm run setup (downloads the Selenium jar, Prometheus and Chromium)"
npm run setup

echo
bold "Preflight done - running the environment check"
npm run doctor
