#!/bin/bash
# ============================================================
# AD 域控连通性检查脚本
# 用法: bash check-ad.sh [域名] [--bind-dn <DN>] [--bind-password <密码>] [--users-dn <DN>] [--limit <N>]
# 示例:
#   bash check-ad.sh acken.int
#   bash check-ad.sh acken.int --bind-dn "CN=svc,DC=acken,DC=int" --bind-password "p@ss"
#   bash check-ad.sh acken.int --bind-dn "..." --bind-password "..." --users-dn "OU=Users,DC=acken,DC=int"
#   bash check-ad.sh acken.int --bind-dn "..." --bind-password "..." --users-dn "..." --limit 0
#     --limit 0  仅统计人数，不打印用户列表
#     --limit 10 最多显示 10 个用户（默认 5）
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── 解析参数 ──────────────────────────────────────────
DOMAIN=""
BIND_DN=""
BIND_PASSWORD=""
USERS_DN=""
LIMIT=5

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bind-dn)       BIND_DN="$2"; shift 2 ;;
        --bind-password) BIND_PASSWORD="$2"; shift 2 ;;
        --users-dn)      USERS_DN="$2"; shift 2 ;;
        --limit)         LIMIT="$2"; shift 2 ;;
        -*)              echo "未知参数: $1"; exit 1 ;;
        *)               DOMAIN="$1"; shift ;;
    esac
done

# 自动检测域名
if [ -z "$DOMAIN" ]; then
    DOMAIN=$(grep -m1 '^search ' /etc/resolv.conf 2>/dev/null | awk '{print $2}' || echo "")
fi
if [ -z "$DOMAIN" ]; then
    echo -e "${RED}[错误] 无法自动检测域名，请手动指定: bash $0 <域名>${NC}"
    exit 1
fi

echo "============================================"
echo "  AD 域控连通性检查"
echo "  域名: ${DOMAIN}"
if [ -n "$BIND_DN" ]; then
    echo "  Bind DN: ${BIND_DN}"
fi
if [ -n "$USERS_DN" ]; then
    echo "  Users DN: ${USERS_DN}"
fi
echo "============================================"
echo ""

# ── Step 1: DNS SRV 发现域控 ──────────────────────
echo -e "${YELLOW}[1/4] 搜索域控 (DNS SRV)${NC}"
python3 << EOF
import dns.resolver, sys
try:
    answers = dns.resolver.resolve('_ldap._tcp.dc._msdcs.${DOMAIN}', 'SRV')
    for a in answers:
        target = a.to_text().split()[-1].rstrip('.')
        print(target)
except Exception as e:
    print(f'ERROR:{e}', file=sys.stderr)
    sys.exit(1)
EOF
if [ $? -ne 0 ]; then
    echo -e "${RED}  ✗ DNS SRV 查询失败 — 请确认域名正确且网络可达${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ 域控发现成功${NC}"
echo ""

# ── Step 2: 检查 LDAP 端口 ────────────────────────
echo -e "${YELLOW}[2/4] 检查 LDAP 端口连通性${NC}"
python3 << EOF
import socket, sys

hosts = ['${DOMAIN}']
try:
    import dns.resolver
    answers = dns.resolver.resolve('_ldap._tcp.dc._msdcs.${DOMAIN}', 'SRV')
    for a in answers:
        hosts.append(a.to_text().split()[-1].rstrip('.'))
except: pass

all_ok = True
for host in hosts[:5]:
    for port, label in [(389, 'LDAP'), (636, 'LDAPS')]:
        try:
            ip = socket.getaddrinfo(host, port)[0][4][0]
            s = socket.create_connection((ip, port), timeout=3)
            s.close()
            print(f'  \033[32m✓\033[0m {label:6s} {host} ({ip}:{port})')
        except Exception as e:
            print(f'  \033[31m✗\033[0m {label:6s} {host} — {e}')
            all_ok = False
    break
sys.exit(0 if all_ok else 1)
EOF
RC=$?
echo ""

# ── Step 3: 匿名绑定（快速冒烟测试） ───────────────
echo -e "${YELLOW}[3/4] LDAP 匿名绑定${NC}"
ANON_OK=false
python3 << EOF
import sys
sys.path.insert(0, '.')
try:
    from ldap3 import Server, Connection, ALL
    server = Server('${DOMAIN}', get_info=ALL, connect_timeout=5)
    conn = Connection(server, auto_bind=True)
    info = server.info
    print(f'  \033[32m✓\033[0m 匿名绑定成功')
    if info:
        if hasattr(info, 'other') and info.other:
            for k, v in info.other.items():
                if 'domain' in str(k).lower() or 'default' in str(k).lower():
                    print(f'    {k}: {v[0] if isinstance(v, list) else v}')
    conn.unbind()
except Exception as e:
    print(f'  \033[33m-\033[0m 匿名绑定被拒绝（生产环境常见）: {e}')
    sys.exit(1)
EOF
if [ $? -eq 0 ]; then
    ANON_OK=true
fi
echo ""

# ── Step 4: 认证绑定 + 用户搜索模拟 ───────────────
echo -e "${YELLOW}[4/4] 认证绑定与用户搜索${NC}"

if [ -z "$BIND_DN" ] || [ -z "$BIND_PASSWORD" ]; then
    echo -e "  ${YELLOW}!\033[0m 未提供 --bind-dn 和 --bind-password，跳过认证测试"
    echo ""
    echo -e "  ${YELLOW}提示:${NC} 使用以下命令测试完整的 LDAP 认证流程(参数分别为 绑定DN，对应密码，用户搜索基准）："
    echo "  bash $0 ${DOMAIN} --bind-dn \"CN=svc,DC=acken,DC=int\" --bind-password \"密码\" --users-dn \"DC=acken,DC=int\""
    echo ""
else
    python3 << PYEOF
import sys
sys.path.insert(0, '.')
from ldap3 import Server, Connection, ALL, SUBTREE

server = Server('${DOMAIN}', get_info=ALL, connect_timeout=5)

# 4a — 认证绑定
print("  [认证绑定] ", end="", flush=True)
try:
    conn = Connection(server, user='${BIND_DN}', password='${BIND_PASSWORD}', auto_bind=True)
    print(f'\033[32m✓\033[0m 绑定成功 (Bind DN 凭据有效)')
    auth_ok = True
except Exception as e:
    print(f'\033[31m✗\033[0m 绑定失败: {e}')
    auth_ok = False

if auth_ok:
    # 4b — 获取目录信息
    if server.info:
        naming = None
        if hasattr(server.info, 'other') and server.info.other:
            naming = server.info.other.get('defaultNamingContext', None)
        if naming:
            print(f"    目录根: {naming[0] if isinstance(naming, list) else naming}")

    # 4c — 用户搜索测试
    search_base = '${USERS_DN}'
    if not search_base:
        # fallback to defaultNamingContext
        if server.info and hasattr(server.info, 'other') and server.info.other:
            nc = server.info.other.get('defaultNamingContext')
            search_base = (nc[0] if isinstance(nc, list) else nc) if nc else ''

    if search_base:
        limit = int('${LIMIT}') if '${LIMIT}'.isdigit() else 5
        print(f"  [用户搜索] 基准: {search_base}  (limit={limit})")
        try:
            # Use paged search to get total count, then fetch up to limit entries
            total_count = 0
            entries = []
            cookie = None
            while True:
                conn.search(
                    search_base=search_base,
                    search_filter='(objectClass=user)',
                    search_scope=SUBTREE,
                    attributes=['sAMAccountName', 'cn', 'mail'],
                    paged_size=100,
                    paged_cookie=cookie
                )
                total_count += len(conn.entries)
                if limit > 0 and len(entries) < limit:
                    entries.extend(conn.entries[:limit - len(entries)])
                cookie = conn.result.get('controls', {}).get('1.2.840.113556.1.4.319', {}).get('value', {}).get('cookie', b'')
                if not cookie:
                    break

            if total_count > 0:
                if limit > 0 and total_count > limit:
                    print(f'    \033[32m✓\033[0m 共 {total_count} 个用户，显示前 {len(entries)} 个:')
                else:
                    print(f'    \033[32m✓\033[0m 共 {total_count} 个用户:')
                for entry in entries:
                    sam = entry.sAMAccountName.value if hasattr(entry, 'sAMAccountName') else '?'
                    cn  = entry.cn.value if hasattr(entry, 'cn') else ''
                    print(f'      - {sam} ({cn})')
            else:
                print(f'    \033[33m!\033[0m 未找到用户 — 检查 usersDn 和 objectClass 是否正确')
        except Exception as e:
            print(f'    \033[33m!\033[0m 搜索失败: {e}')
    else:
        print(f'  \033[33m!\033[0m 无法确定搜索基准 — 请使用 --users-dn 指定')

    conn.unbind()
else:
    print(f'  \033[33m!\033[0m 认证失败，跳过用户搜索')

PYEOF
fi

# ── 结论 ──────────────────────────────────────────
echo ""
if [ $RC -ne 0 ]; then
    echo -e "${RED}============================================${NC}"
    echo -e "${RED}  ✗ LDAP 端口不可达，请检查防火墙或 VPN${NC}"
    echo -e "${RED}============================================${NC}"
    exit 1
elif [ -n "$BIND_DN" ] && [ -n "$BIND_PASSWORD" ]; then
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  ✓ AD 域控连通正常，凭据有效${NC}"
    echo -e "${GREEN}============================================${NC}"
elif [ "$ANON_OK" = true ]; then
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  ✓ AD 域控连通正常（匿名访问开放）${NC}"
    echo -e "${GREEN}============================================${NC}"
else
    echo -e "${YELLOW}============================================${NC}"
    echo -e "${YELLOW}  ✓ 端口可达，需提供凭据完成完整检测${NC}"
    echo -e "${YELLOW}============================================${NC}"
fi
