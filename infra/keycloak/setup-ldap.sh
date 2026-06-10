#!/bin/sh
# ============================================================
# Keycloak LDAP User Federation 配置脚本
# 在 keycloak-setup 容器中运行（one-shot）
# 仅当 LDAP_ENABLED=true 时执行 LDAP 联合配置
# ============================================================
set -eu

KEYCLOAK_URL="${KEYCLOAK_URL:-http://keycloak:8080}"
REALM="${KEYCLOAK_REALM:-llm-dlp}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-admin}"

# ── 等待 Keycloak 就绪 ────────────────────────────────
echo ">>> 等待 Keycloak 就绪..."
MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    if curl -sf "${KEYCLOAK_URL}/realms/master" >/dev/null 2>&1; then
        echo ">>> Keycloak 已就绪"
        break
    fi
    RETRY=$((RETRY + 1))
    sleep 2
done

if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "!!! Keycloak 启动超时"
    exit 1
fi

# ── 获取 Admin Token ────────────────────────────────────
TOKEN=$(curl -sf \
    -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password" \
    -d "client_id=admin-cli" \
    -d "username=${ADMIN_USER}" \
    -d "password=${ADMIN_PASS}" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
    echo "!!! 获取 admin token 失败"
    exit 1
fi

AUTH="Authorization: Bearer ${TOKEN}"
API="${KEYCLOAK_URL}/admin/realms/${REALM}"

# ── LDAP 联合配置 ──────────────────────────────────────
if [ "${LDAP_ENABLED:-false}" != "true" ]; then
    echo ">>> LDAP_ENABLED=false，跳过 LDAP 联合配置"
    echo ">>> Keycloak 将仅使用本地数据库认证"
    exit 0
fi

if [ -z "${LDAP_URL:-}" ]; then
    echo "!!! LDAP_ENABLED=true 但 LDAP_URL 未设置，跳过"
    exit 0
fi

echo ">>> 检查已有 LDAP 联合配置..."
EXISTING=$(curl -sf \
    "${API}/components?type=org.keycloak.storage.UserStorageProvider&name=ldap-ad" \
    -H "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")

if [ "$EXISTING" -gt 0 ]; then
    echo ">>> LDAP 联合已存在，跳过创建"
    exit 0
fi

echo ">>> 创建 LDAP User Federation (Active Directory)..."

LDAP_VENDOR="${LDAP_VENDOR:-ad}"
LDAP_USERNAME_ATTR="${LDAP_USERNAME_ATTR:-sAMAccountName}"
LDAP_RDN_ATTR="${LDAP_RDN_ATTR:-sAMAccountName}"
LDAP_UUID_ATTR="${LDAP_UUID_ATTR:-objectGUID}"
LDAP_FILTER="${LDAP_FILTER:-}"
LDAP_BATCH_SIZE="${LDAP_BATCH_SIZE:-1000}"

# 构建 JSON payload
PAYLOAD=$(python3 -c "
import json
payload = {
    'name': 'ldap-ad',
    'providerId': 'ldap',
    'providerType': 'org.keycloak.storage.UserStorageProvider',
    'parentId': '${REALM}',
    'config': {
        'enabled': ['true'],
        'priority': ['1'],
        'editMode': ['WRITABLE'],
        'syncRegistrations': ['false'],
        'vendor': ['${LDAP_VENDOR}'],
        'usernameLDAPAttribute': ['${LDAP_USERNAME_ATTR}'],
        'rdnLDAPAttribute': ['${LDAP_RDN_ATTR}'],
        'uuidLDAPAttribute': ['${LDAP_UUID_ATTR}'],
        'userObjectClasses': ['person,organizationalPerson,user'],
        'connectionUrl': ['${LDAP_URL}'],
        'usersDn': ['${LDAP_USERS_DN:-}'],
        'bindDn': ['${LDAP_BIND_DN:-}'],
        'bindCredential': ['${LDAP_BIND_CREDENTIALS:-}'],
        'authType': ['simple'],
        'searchScope': ['1'],
        'useTruststoreSpi': ['${LDAP_USE_TRUSTSTORE_SPI:-false}'],
        'connectionPooling': ['true'],
        'importEnabled': ['true'],
        'cachePolicy': ['DEFAULT'],
        'fullSyncPeriod': ['86400'],
        'changedSyncPeriod': ['3600'],
        'batchSizeForSync': ['${LDAP_BATCH_SIZE}'],
    }
}
# 可选 LDAP 过滤器
if '${LDAP_FILTER}':
    payload['config']['customUserSearchFilter'] = ['${LDAP_FILTER}']
print(json.dumps(payload))
")

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${API}/components" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    echo ">>> ✓ LDAP 联合创建成功 (HTTP ${HTTP_CODE})"
else
    echo "!!! LDAP 联合创建失败 (HTTP ${HTTP_CODE})"
    # 打印错误详情
    curl -s -X POST "${API}/components" \
        -H "$AUTH" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" 2>&1 || true
    exit 1
fi

# ── 触发初始同步 ──────────────────────────────────────
echo ">>> 查找 LDAP 组件 ID..."
COMP_ID=$(curl -sf \
    "${API}/components?type=org.keycloak.storage.UserStorageProvider&name=ldap-ad" \
    -H "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null || echo "")

if [ -n "$COMP_ID" ]; then
    echo ">>> 触发初始 LDAP 用户同步..."
    curl -sf -X POST "${API}/user-storage/${COMP_ID}/sync?action=triggerFullSync" \
        -H "$AUTH" >/dev/null 2>&1 || true
    echo ">>> ✓ LDAP 同步已触发"
fi

echo ">>> ✓ Keycloak LDAP 配置完成"
