#!/usr/bin/env bash
# dev-custom.sh — Custom development startup script for Multica (channels-dm worktree)
#
# Usage:
#   ./scripts/dev-custom.sh              # Interactive menu
#   ./scripts/dev-custom.sh server       # Start backend only (port 18815)
#   ./scripts/dev-custom.sh frontend     # Start frontend only (port 13735)
#   ./scripts/dev-custom.sh login        # Login with default token
#   ./scripts/dev-custom.sh daemon       # Start local daemon
#   ./scripts/dev-custom.sh all          # Start backend + frontend
#   ./scripts/dev-custom.sh full         # Login + daemon (for CLI/daemon workflows)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---- Default ports (customized for channels-dm worktree) ----
PORT=${PORT:-18815}
FRONTEND_PORT=${FRONTEND_PORT:-13735}
FRONTEND_ORIGIN=${FRONTEND_ORIGIN:-http://localhost:$FRONTEND_PORT}
MULTICA_SERVER_URL=${MULTICA_SERVER_URL:-http://localhost:$PORT}
DATABASE_URL=${DATABASE_URL:-postgres://multica:multica@localhost:5432/multica_channels?sslmode=disable}

# Default auth token
AUTH_TOKEN=${AUTH_TOKEN:-mul_ef5b6007bc0c375e8409ed4ff9afcc3170157f07}

export PORT FRONTEND_PORT FRONTEND_ORIGIN MULTICA_SERVER_URL DATABASE_URL

# ---- Helper functions ----
info() {
  echo "  $1"
}

header() {
  echo ""
  echo "==> $1"
}

check_env() {
  if [ ! -f .env ] && [ ! -f .env.worktree ]; then
    echo "No .env file found. Run 'make setup' first."
    exit 1
  fi
  set -a
  if [ -f .env.worktree ]; then
    . .env.worktree
  elif [ -f .env ]; then
    . .env
  fi
  set +a
}

# ---- Commands ----

cmd_server() {
  header "Starting backend server"
  info "PORT:        $PORT"
  info "FRONTEND_ORIGIN: $FRONTEND_ORIGIN"
  info "DATABASE_URL:    (hidden)"
  cd "$REPO_ROOT/server" && go run ./cmd/server
}

cmd_frontend() {
  header "Starting frontend dev server"
  info "FRONTEND_PORT: $FRONTEND_PORT"
  info "MULTICA_SERVER_URL: $MULTICA_SERVER_URL"
  cd "$REPO_ROOT/apps/web" && FRONTEND_PORT=$FRONTEND_PORT pnpm dev
}

cmd_login() {
  header "Logging in with CLI"
  info "MULTICA_SERVER_URL: $MULTICA_SERVER_URL"
  cd "$REPO_ROOT/server" && MULTICA_SERVER_URL=$MULTICA_SERVER_URL go run ./cmd/multica login --token <<< "$AUTH_TOKEN"
}

cmd_daemon() {
  header "Starting local daemon"
  info "MULTICA_SERVER_URL: $MULTICA_SERVER_URL"
  cd "$REPO_ROOT/server" && MULTICA_SERVER_URL=$MULTICA_SERVER_URL go run ./cmd/multica daemon start
}

cmd_all() {
  header "Starting all services (backend + frontend)"
  info "Backend:  http://localhost:$PORT"
  info "Frontend: http://localhost:$FRONTEND_PORT"
  info "WS:      $MULTICA_SERVER_URL"
  trap 'kill 0' EXIT
  (cd "$REPO_ROOT/server" && go run ./cmd/server) &
  (cd "$REPO_ROOT/apps/web" && FRONTEND_PORT=$FRONTEND_PORT pnpm dev) &
  wait
}

cmd_full() {
  cmd_login
  echo ""
  cmd_daemon
}

# ---- Menu ----
show_help() {
  echo ""
  echo "Multica Custom Dev Script (channels-dm worktree)"
  echo ""
  echo "Usage: ./scripts/dev-custom.sh <command>"
  echo ""
  echo "Commands:"
  echo "  server   - Start backend only (port $PORT)"
  echo "  frontend - Start frontend only (port $FRONTEND_PORT)"
  echo "  login    - Login with CLI using default token"
  echo "  daemon   - Start local daemon"
  echo "  all      - Start backend + frontend together"
  echo "  full     - Login + start daemon (full CLI workflow)"
  echo "  help     - Show this message"
  echo ""
  echo "Environment variables (with defaults):"
  echo "  PORT=$PORT"
  echo "  FRONTEND_PORT=$FRONTEND_PORT"
  echo "  AUTH_TOKEN=***"
  echo ""
}

# ---- Main ----
COMMAND="${1:-help}"

case "$COMMAND" in
  server|frontend|login|daemon|all|full)
    check_env
    ;;
esac

case "$COMMAND" in
  server)   cmd_server ;;
  frontend) cmd_frontend ;;
  login)    cmd_login ;;
  daemon)   cmd_daemon ;;
  all)      cmd_all ;;
  full)     cmd_full ;;
  help|--help|-h) show_help ;;
  *)
    echo "Unknown command: $COMMAND"
    show_help
    exit 1
    ;;
esac
