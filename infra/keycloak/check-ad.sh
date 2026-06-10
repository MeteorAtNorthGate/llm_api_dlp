#!/bin/bash
# ============================================================
# AD 域控连通性检查脚本
# 用法: bash check-ad.sh [域名]
# 示例: bash check-ad.sh acken.int
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 获取域名
DOMAIN="${1:-}"
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
echo "============================================"
echo ""

# ── Step 1: DNS SRV 发现域控 ──────────────────────
echo -e "${YELLOW}[1/3] 搜索域控 (DNS SRV)${NC}"
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
echo -e "${YELLOW}[2/3] 检查 LDAP 端口连通性${NC}"
python3 << EOF
import socket, sys

hosts = ['${DOMAIN}']
# 也尝试解析域控主机名
try:
    import dns.resolver
    answers = dns.resolver.resolve('_ldap._tcp.dc._msdcs.${DOMAIN}', 'SRV')
    for a in answers:
        hosts.append(a.to_text().split()[-1].rstrip('.'))
except:
    pass

all_ok = True
for host in hosts[:5]:  # 最多检查5个
    for port, label in [(389, 'LDAP'), (636, 'LDAPS')]:
        try:
            ip = socket.getaddrinfo(host, port)[0][4][0]
            s = socket.create_connection((ip, port), timeout=3)
            s.close()
            print(f'  \033[32m✓\033[0m {label:6s} {host} ({ip}:{port})')
        except Exception as e:
            print(f'  \033[31m✗\033[0m {label:6s} {host} — {e}')
            all_ok = False
    break  # 只检查第一个可达的 DC
sys.exit(0 if all_ok else 1)
EOF
RC=$?
echo ""

# ── Step 3: 匿名 LDAP 绑定测试 ────────────────────
echo -e "${YELLOW}[3/3] LDAP 匿名绑定测试${NC}"
python3 << EOF
import sys
sys.path.insert(0, '.')
try:
    from ldap3 import Server, Connection, ALL
    server = Server('${DOMAIN}', get_info=ALL, connect_timeout=5)
    conn = Connection(server, auto_bind=True)  # 匿名绑定
    info = server.info
    print(f'  \033[32m✓\033[0m 匿名绑定成功')
    if info:
        if hasattr(info, 'other') and info.other:
            for k, v in info.other.items():
                if 'domain' in str(k).lower() or 'default' in str(k).lower():
                    print(f'    {k}: {v[0] if isinstance(v, list) else v}')
    conn.unbind()
except Exception as e:
    print(f'  \033[33m!\033[0m 匿名绑定被拒绝: {e}')
    print(f'  \033[33m!\033[0m 这是正常的 — AD 通常禁止匿名绑定，需要专用账号')
    print(f'  \033[32m✓\033[0m 但 LDAP 端口已连通，配置 Bind DN 后即可使用')
EOF

echo ""

# ── 结论 ──────────────────────────────────────────
if [ $RC -eq 0 ]; then
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  ✓ AD 域控连通正常，可以继续配置 Keycloak${NC}"
    echo -e "${GREEN}============================================${NC}"
else
    echo -e "${RED}============================================${NC}"
    echo -e "${RED}  ✗ LDAP 端口不可达，请检查防火墙或 VPN${NC}"
    echo -e "${RED}============================================${NC}"
    exit 1
fi
