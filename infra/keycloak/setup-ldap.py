#!/usr/bin/env python3
"""Keycloak LDAP User Federation 自动配置 —— 在 keycloak-setup 容器里跑一次。

与前端 GUI 的关系
    前端「LDAP 认证源」页面（LdapAdminPage → api-server /admin/ldap/sources）
    以及本脚本，改的都是同一个东西：Keycloak 里 providerType 为
    org.keycloak.storage.UserStorageProvider 的组件。GUI 能增删改和手动同步，
    是本项目实际使用的路径；本脚本是给无人值守部署用的后备路径，
    由 infra/.env.cloud 的环境变量驱动，启动时自动建一次。

    两条路径不要同时维护同一份配置：本脚本按 LDAP 地址判重，同一个地址已经配过
    （不论组件叫什么名字）就跳过，不会建出第二个 provider。

为什么是纯 python3 而不是 shell + curl
    基础镜像 python:3.14-slim 里没有 curl，而容器启动时再去 apt-get 装一个
    会把「访问 compose 网络里的 Keycloak」这件本来不需要外网的事，变成依赖
    公网软件源 —— 这是本脚本被写坏过一次的原因（见 git 历史里那行
    `apk add --no-cache curl`：Debian 镜像上没有 apk，容器一启动就退出，
    LDAP 配置从未生效，而且失败得很安静）。改用标准库 urllib 之后，
    容器只需要能连上 keycloak:8080。

环境变量见 infra/.env.cloud 的「Active Directory / LDAP」段。
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

KEYCLOAK_URL = os.environ.get("KEYCLOAK_URL", "http://keycloak:8080").rstrip("/")
REALM = os.environ.get("KEYCLOAK_REALM", "llm-dlp")
ADMIN_USER = os.environ.get("KEYCLOAK_ADMIN", "admin")
ADMIN_PASS = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "admin")

COMPONENT_NAME = "ldap-ad"
PROVIDER_TYPE = "org.keycloak.storage.UserStorageProvider"


def log(msg):
    # flush：容器日志要能实时看到，卡住时才不用猜
    print(f">>> {msg}", flush=True)


def request(method, url, *, form=None, body=None, token=None, timeout=15):
    """发一个请求，返回 (HTTP 状态码, 解析后的 JSON 或原始文本)。

    不抛 HTTPError —— 调用方需要看状态码来决定行为（比如 201 vs 400）。
    连接层面的错误（拒绝连接、DNS 失败）会抛 OSError，由调用方处理。
    """
    req = urllib.request.Request(url, method=method)
    if body is not None:
        req.data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    elif form is not None:
        req.data = urllib.parse.urlencode(form).encode()
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status, raw = resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read().decode()

    try:
        return status, (json.loads(raw) if raw.strip() else None)
    except json.JSONDecodeError:
        return status, raw


def api(path):
    return f"{KEYCLOAK_URL}/admin/realms/{REALM}{path}"


def components_url():
    query = urllib.parse.urlencode({"type": PROVIDER_TYPE, "name": COMPONENT_NAME})
    return api(f"/components?{query}")


def all_providers_url():
    return api(f"/components?{urllib.parse.urlencode({'type': PROVIDER_TYPE})}")


def normalize_ldap_url(url):
    """把同一台 LDAP 的不同写法归一，用于判重。

    GUI 建 connectionUrl 时省略默认端口（389 -> ldap://host，636 -> ldaps://host:636），
    所以 .env.cloud 里写 ldap://host:389 会和它长得不一样 —— 直接比字符串会误判成两台。
    """
    u = url.strip().lower().rstrip("/")
    for scheme, default_port in (("ldaps://", 636), ("ldap://", 389)):
        if u.startswith(scheme):
            rest = u[len(scheme):]
            if rest.endswith(f":{default_port}"):
                rest = rest[: -len(f":{default_port}")]
            return scheme + rest
    return u


def main():
    # ── 等待 Keycloak 就绪 ────────────────────────────────────────
    log("等待 Keycloak 就绪...")
    for _ in range(30):
        try:
            status, _ = request("GET", f"{KEYCLOAK_URL}/realms/master")
        except OSError:
            status = 0
        if status == 200:
            log("Keycloak 已就绪")
            break
        time.sleep(2)
    else:
        log("!!! Keycloak 启动超时")
        return 1

    # ── 取 admin token ───────────────────────────────────────────
    status, data = request(
        "POST",
        f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
        form={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": ADMIN_USER,
            "password": ADMIN_PASS,
        },
    )
    token = data.get("access_token") if isinstance(data, dict) else None
    if status != 200 or not token:
        log(f"!!! 获取 admin token 失败 (HTTP {status})")
        return 1

    # ── 是否该动手 ───────────────────────────────────────────────
    if os.environ.get("LDAP_ENABLED", "false") != "true":
        log("LDAP_ENABLED≠true，跳过 LDAP 联合配置")
        log("Keycloak 将仅使用本地数据库认证（LDAP 请在 GUI 里配）")
        return 0

    ldap_url = os.environ.get("LDAP_URL", "")
    if not ldap_url:
        # 明确跳过，而不是拿占位值去建一个连不上的 provider —— 那会拖坏登录。
        log("!!! LDAP_ENABLED=true 但 LDAP_URL 为空，跳过")
        log("    要启用自动配置，请在 infra/.env.cloud 里补齐以下四项")
        log("    （取值与 GUI 里配的 AD 参数一致）：")
        log("      LDAP_URL  LDAP_BIND_DN  LDAP_BIND_CREDENTIALS  LDAP_USERS_DN")
        return 0

    # ── 已存在就跳过（GUI 可能已经配过了）────────────────────────
    # 判据是「LDAP 地址」，不是「组件名」：GUI 那边的 name 是给登录页显示用的
    # （提示文案就是"例如：公司内部AD域"），脚本这边固定叫 ldap-ad —— 按名字比永远
    # 撞不上，结果会是同一台 AD 被配成两个 provider，登录时被查两遍。
    status, providers = request("GET", all_providers_url(), token=token)
    target = normalize_ldap_url(ldap_url)
    same = [
        comp
        for comp in (providers if isinstance(providers, list) else [])
        if any(
            normalize_ldap_url(u) == target
            for u in (comp.get("config") or {}).get("connectionUrl") or []
        )
    ]
    if same:
        log(f"已存在指向 {ldap_url} 的 LDAP 联合（组件名：{same[0].get('name')}），跳过创建")
        log("    如需改参数请在 GUI 里改，或先删掉该认证源再让本脚本重建")
        return 0

    # ── 创建 LDAP User Federation ────────────────────────────────
    log(f"创建 LDAP User Federation（vendor={os.environ.get('LDAP_VENDOR', 'ad')}）...")
    payload = {
        "name": COMPONENT_NAME,
        "providerId": "ldap",
        "providerType": PROVIDER_TYPE,
        "parentId": REALM,
        "config": {
            "enabled": ["true"],
            "priority": ["1"],
            "editMode": ["READ_ONLY"],
            "syncRegistrations": ["false"],
            "vendor": [os.environ.get("LDAP_VENDOR", "ad")],
            "usernameLDAPAttribute": [os.environ.get("LDAP_USERNAME_ATTR", "sAMAccountName")],
            "rdnLDAPAttribute": [os.environ.get("LDAP_RDN_ATTR", "sAMAccountName")],
            "uuidLDAPAttribute": [os.environ.get("LDAP_UUID_ATTR", "objectGUID")],
            "userObjectClasses": ["person,organizationalPerson,user"],
            "connectionUrl": [ldap_url],
            "usersDn": [os.environ.get("LDAP_USERS_DN", "")],
            "bindDn": [os.environ.get("LDAP_BIND_DN", "")],
            "bindCredential": [os.environ.get("LDAP_BIND_CREDENTIALS", "")],
            "authType": ["simple"],
            "searchScope": ["1"],
            "useTruststoreSpi": [os.environ.get("LDAP_USE_TRUSTSTORE_SPI", "false")],
            "connectionPooling": ["true"],
            "importEnabled": ["true"],
            "cachePolicy": ["DEFAULT"],
            "fullSyncPeriod": ["86400"],
            "changedSyncPeriod": ["3600"],
            "batchSizeForSync": [os.environ.get("LDAP_BATCH_SIZE", "1000")],
        },
    }
    if os.environ.get("LDAP_FILTER"):
        payload["config"]["customUserSearchFilter"] = [os.environ["LDAP_FILTER"]]

    status, data = request("POST", api("/components"), body=payload, token=token)
    if status not in (200, 201):
        log(f"!!! LDAP 联合创建失败 (HTTP {status})")
        log(f"    {data}")
        return 1
    log(f"✓ LDAP 联合创建成功 (HTTP {status})")

    # ── 触发初始同步 ─────────────────────────────────────────────
    status, comps = request("GET", components_url(), token=token)
    if isinstance(comps, list) and comps:
        comp_id = comps[0]["id"]
        log("触发初始 LDAP 用户同步...")
        status, _ = request(
            "POST", api(f"/user-storage/{comp_id}/sync?action=triggerFullSync"), token=token
        )
        if status < 400:
            log("✓ LDAP 同步已触发")
        else:
            log(f"!!! 同步触发失败 (HTTP {status})")

    log("✓ Keycloak LDAP 配置完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
