cd ~/Desktop/cde_mvp_python/gateway_node
printf '%s\n' \
'```bash' \
'npm run demo' \
'```' \
'' \
'```text' \
'> cde-gateway-node@1.0.0 demo' \
'> node demo.js' \
'' \
'GATE 0 ✅ PASS' \
'GATE 1 ⚠️ EVIDENCE REQUIRED' \
'GATE 1 ✅ PASS' \
'GATE 2 ⛔ BLOCKED (delete /project)' \
'GATE 2 ⛔ BLOCKED (delete /project/tmp/* without lease)' \
'GATE 2 ✅ LEASED ALLOW (delete /project/tmp/* with lease)' \
'' \
'/statuses { ... }' \
'```' \
> TRANSCRIPT.md