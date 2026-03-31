#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${SMOKE_BASE_URL:-http://127.0.0.1:3000}}"
BASE_URL="${BASE_URL%/}"

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: $2"; exit 1; }

echo "Smoke base URL: $BASE_URL"

health_json="$(curl -sS "$BASE_URL/healthz")" || fail "healthz" "request failed"
echo "$health_json" | rg '"ok":true' >/dev/null || fail "healthz" "missing ok=true"
echo "$health_json" | rg '"mcpEndpoint":"' >/dev/null || fail "healthz" "missing mcpEndpoint"
pass "healthz"

manifest_json="$(curl -sS "$BASE_URL/api/integration/manifest")" || fail "integration manifest" "request failed"
echo "$manifest_json" | rg '"code":0' >/dev/null || fail "integration manifest" "missing code=0"
echo "$manifest_json" | rg '"manifest"' >/dev/null || fail "integration manifest" "missing manifest"
echo "$manifest_json" | rg '"endpoint":"' >/dev/null || fail "integration manifest" "missing endpoint"
pass "integration manifest"

tools_json="$(curl -sS "$BASE_URL/api/integration/tools")" || fail "integration tools list" "request failed"
echo "$tools_json" | rg '"code":0' >/dev/null || fail "integration tools list" "missing code=0"
echo "$tools_json" | rg '"get_user_profile"' >/dev/null || fail "integration tools list" "missing get_user_profile"
echo "$tools_json" | rg '"get_persona_snapshot"' >/dev/null || fail "integration tools list" "missing get_persona_snapshot"
pass "integration tools list"

exec_status="$(curl -sS -o /tmp/99x_exec_resp.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/api/integration/execute" \
  --data '{"toolName":"get_user_profile","args":{}}')" || fail "integration execute unauth behavior" "request failed"
if [[ "$exec_status" != "200" && "$exec_status" != "401" ]]; then
  fail "integration execute unauth behavior" "unexpected status $exec_status"
fi
pass "integration execute unauth behavior"

mcp_init_json="$(curl -sS -H "Content-Type: application/json" -X POST "$BASE_URL/mcp" --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')" || fail "mcp initialize" "request failed"
echo "$mcp_init_json" | rg '"protocolVersion"' >/dev/null || fail "mcp initialize" "missing protocolVersion"
pass "mcp initialize"

mcp_tools_json="$(curl -sS -H "Content-Type: application/json" -X POST "$BASE_URL/mcp" --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')" || fail "mcp tools/list" "request failed"
echo "$mcp_tools_json" | rg '"tools"' >/dev/null || fail "mcp tools/list" "missing tools"
echo "$mcp_tools_json" | rg '"list_uploaded_novels"' >/dev/null || fail "mcp tools/list" "missing list_uploaded_novels"
pass "mcp tools/list"

mcp_call_json="$(curl -sS -H "Content-Type: application/json" -X POST "$BASE_URL/mcp" --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_user_profile","arguments":{}}}')" || fail "mcp tools/call unauth behavior" "request failed"
echo "$mcp_call_json" | rg '"result"|"error"' >/dev/null || fail "mcp tools/call unauth behavior" "missing result or error"
pass "mcp tools/call unauth behavior"

echo
echo "Smoke tests passed."
