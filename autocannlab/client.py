"""GitCode API 客户端：Bearer JWT 认证、token 刷新与轮换回写、通用请求封装。

认证机制（2026-10-06 抓包验证，见 .agents/memory/gitcode-cannlab-api-map.md）：
- access_token 有效期 24h，refresh_token 有效期 60d，均为 HS512 JWT。
- 刷新端点会同时下发新的 refresh_token（轮换），必须持久化，否则旧 refresh
  在服务端失效后只能人工重新登录。
"""

import base64
import json
import logging
import time

import httpx

from . import config

log = logging.getLogger(__name__)

# 与真实浏览器一致的完整头。CloudWAF（HTTP 418「访问被拦截」）对头做完整性检查：
# 只带 API 必需头会被拦，补齐 sec-*/accept 家族后放行（2026-10-06 实测）。
COMMON_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9",
    "sec-ch-ua": '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "referer": "https://gitcode.com/",
    "x-app-channel": "gitcode-fe",
    "x-platform": "web",
    "x-device-id": "unknown",
    "x-device-type": "Win32",
    "x-app-version": "0",
    "x-network-type": "4g",
    "x-os-version": "Unknown",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"
    ),
}


class ApiError(RuntimeError):
    """接口返回非 2xx 或业务错误码。message 为服务端 error_message 或原始 body。"""

    def __init__(self, status: int, message: str, error_code=None):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message
        self.error_code = error_code


def _jwt_exp(token: str) -> float | None:
    """解码 JWT payload 的 exp（不验签，仅用于本地判断是否临近过期）。"""
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64))["exp"]
    except Exception:
        return None


class GitCodeClient:
    def __init__(self, secrets_path=None):
        self.secrets_path = secrets_path or config.SECRETS_PATH
        self.http = httpx.Client(
            base_url=config.API_BASE,
            headers=COMMON_HEADERS,
            timeout=30.0,
            follow_redirects=True,
        )
        self._tokens = json.loads(self.secrets_path.read_text(encoding="utf-8"))
        # WAF 会话 cookie：访问主站时由 CloudWAF 下发（HWWAFSESID/HWWAFSESTIME），
        # API 域名（web-api.gitcode.com）同样受 WAF 检查，需手工附带
        self._waf_cookies: dict[str, str] = {}

    def bootstrap_waf(self) -> None:
        """访问一次主站页面领取 WAF cookie；后续 API 请求手工附带。"""
        resp = self.http.get(config.SITE_BASE.rstrip("/") + "/cann")
        for name in ("HWWAFSESID", "HWWAFSESTIME"):
            value = self.http.cookies.get(name)
            if value:
                self._waf_cookies[name] = value
        if not self._waf_cookies:
            log.warning("主站未下发 WAF cookie（HTTP %s），API 调用可能被 418 拦截",
                        resp.status_code)
        else:
            log.debug("WAF cookie 就绪: %s", list(self._waf_cookies))

    # ---------- 凭证 ----------

    @property
    def access_token(self) -> str:
        return self._tokens["access_token"]

    @property
    def username(self) -> str:
        return self._tokens.get("username", "")

    @property
    def refresh_expires_at(self) -> float | None:
        return _jwt_exp(self._tokens["refresh_token"])

    def _persist_tokens(self) -> None:
        self.secrets_path.write_text(
            json.dumps(self._tokens, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def prepare(self) -> None:
        """每次运行的入口：领取 WAF cookie + 保证 access_token 新鲜。"""
        self.bootstrap_waf()
        self.ensure_fresh_access()

    def ensure_fresh_access(self) -> None:
        """access 剩余有效期不足 10 分钟时刷新。"""
        exp = _jwt_exp(self._tokens["access_token"])
        if exp is None or exp - time.time() < 600:
            self.refresh_tokens()

    def refresh_tokens(self) -> None:
        """用 refresh_token 换新凭证对并回写文件。刷新失败意味着必须人工重新登录。"""
        resp = self.http.post(
            "/uc/api/v1/user/token/refresh",
            data={"refresh_token": self._tokens["refresh_token"]},
            headers={
                "Authorization": f"Bearer {self._tokens['access_token']}",
                # 前端即用 form content-type + 表单体（bundle 反解确认）
                "content-type": "application/x-www-form-urlencoded",
            },
        )
        if resp.status_code != 200:
            raise ApiError(resp.status_code, resp.text[:300])
        body = resp.json()
        data = body.get("data") if isinstance(body.get("data"), dict) else body
        new_access = data.get("access_token")
        new_refresh = data.get("refresh_token")
        if not new_access or not new_refresh:
            raise ApiError(200, f"刷新响应缺少 token 字段: {str(body)[:300]}")
        self._tokens["access_token"] = new_access
        self._tokens["refresh_token"] = new_refresh
        self._persist_tokens()
        log.info("token 已刷新并回写（refresh 有效期至 %s）",
                 time.strftime("%Y-%m-%d %H:%M", time.localtime(self.refresh_expires_at))
                 if self.refresh_expires_at else "未知")

    def days_until_relogin_needed(self) -> float | None:
        exp = self.refresh_expires_at
        return None if exp is None else (exp - time.time()) / 86400

    # ---------- 请求 ----------

    def request(self, method: str, url: str, *, api_base: str | None = None, **kwargs):
        """带认证与 WAF cookie 的请求；401 时刷新后重试一次；418 时重新领取
        WAF cookie 再重试一次。url 以 / 开头时基于 API_BASE；传 api_base=
        config.SITE_BASE 可访问主站页面（httpx 对绝对 URL 忽略 base_url）。"""
        if api_base is not None:
            url = api_base.rstrip("/") + url
        for attempt in range(3):
            headers = {"Authorization": f"Bearer {self._tokens['access_token']}"}
            if self._waf_cookies and api_base is None:
                headers["cookie"] = "; ".join(f"{k}={v}" for k, v in self._waf_cookies.items())
            resp = self.http.request(method, url, headers=headers, **kwargs)
            if resp.status_code == 401 and attempt < 2:
                log.info("收到 401，尝试刷新 token 后重试")
                self.refresh_tokens()
                continue
            if resp.status_code == 418 and attempt < 2:
                # WAF 会话过期/被拦截：重新 bootstrap
                log.info("收到 418，重新领取 WAF cookie 后重试")
                self.bootstrap_waf()
                continue
            return resp
        return resp

    def get_json(self, url: str, **kwargs):
        resp = self.request("GET", url, **kwargs)
        return self._parse_json(resp)

    def post_json(self, url: str, *, body=None, **kwargs):
        resp = self.request("POST", url, json=body if body is not None else {}, **kwargs)
        return self._parse_json(resp)

    def delete_json(self, url: str, **kwargs):
        resp = self.request("DELETE", url, **kwargs)
        return self._parse_json(resp)

    @staticmethod
    def _parse_json(resp: httpx.Response):
        if resp.status_code >= 400:
            try:
                err = resp.json()
                raise ApiError(resp.status_code, err.get("error_message", resp.text[:300]),
                               err.get("error_code"))
            except (json.JSONDecodeError, ValueError):
                raise ApiError(resp.status_code, resp.text[:300])
        if not resp.content:
            return {}
        try:
            return resp.json()
        except json.JSONDecodeError:
            # 部分接口成功时返回空体
            return {}
