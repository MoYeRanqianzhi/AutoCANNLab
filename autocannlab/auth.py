"""GitCode 登录流程（服务端代理）：扫码 / 短信 / 密码。

端点与报文结构均来自 2026-10-07 前端 bundle 反解与浏览器抓包：

- 扫码：POST /uc/api/v1/qrcode/{platform} 创建 → GET 同路径轮询 →
  POST /api/v1/user/oauth/login/qrcode/{platform}?scene_id= 换取令牌。
- 短信：POST /api/v1/user/sms/send/codeByBiz（biz_enum=LOGIN，需易盾验证参数）→
  POST /api/v1/user/oauth/login/mobile（form: mobile / verification_code / mask，
  mask 取自发码响应）。
- 密码：POST /api/v1/user/oauth/login（form: username / password(ANSI，
  AES-CBC 加密) / captcha_*），AES key/iv 为前端内置常量。

验证码：网易易盾（前端 SDK 完成挑战后产出 validate 四元组，随请求透传给
GitCode），服务端不做验证码识别。
"""

import base64
import json
import logging

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
import httpx

from .client import COMMON_HEADERS, ApiError
from .config import API_BASE, SITE_BASE

log = logging.getLogger(__name__)

# 前端内置的密码加密常量（bundle 明文暴露，非机密）
AES_KEY = b"SA!nUNPZ5o!OSV&B"
AES_IV = b"SA!nwwwZ5o!OSV&B"

QR_PLATFORM = "wechat_mini_program"
# 登录打点来源（前端为 localStorage 的 login_trigger_source，非认证字段）
X_SOURCE = "autocannlab"


def encrypt_password(plain: str) -> str:
    """与前端 CryptoJS.AES.encrypt(pw, key, {iv, padding: Pkcs7}) 等价
    （CryptoJS 传字符串 key/iv 时按 Utf8 解析，mode 默认 CBC，输出 base64）。"""
    cipher = AES.new(AES_KEY, AES.MODE_CBC, AES_IV)
    encrypted = cipher.encrypt(pad(plain.encode("utf-8"), AES.block_size))
    return base64.b64encode(encrypted).decode("ascii")


class LoginClient:
    """未认证的登录会话：自带 WAF 过检与登录专用头。短期驻留内存。"""

    def __init__(self, proxy_url: str | None = None):
        self.http = httpx.Client(
            base_url=API_BASE,
            headers=COMMON_HEADERS,
            timeout=30.0,
            follow_redirects=True,
            proxy=proxy_url,
        )
        self._waf_cookies: dict[str, str] = {}
        self.bootstrap_waf()

    def bootstrap_waf(self) -> None:
        resp = self.http.get(SITE_BASE.rstrip("/") + "/cann")
        for name in ("HWWAFSESID", "HWWAFSESTIME"):
            value = self.http.cookies.get(name)
            if value:
                self._waf_cookies[name] = value
        if not self._waf_cookies:
            log.warning("登录会话未取到 WAF cookie（HTTP %s）", resp.status_code)

    def _headers(self, extra: dict | None = None) -> dict:
        headers = {"x-source": X_SOURCE}
        if self._waf_cookies:
            headers["cookie"] = "; ".join(
                f"{k}={v}" for k, v in self._waf_cookies.items()
            )
        if extra:
            headers.update(extra)
        return headers

    def _parse(self, resp: httpx.Response) -> dict:
        if resp.status_code >= 400:
            try:
                err = resp.json()
                raise ApiError(resp.status_code,
                               err.get("error_message") or resp.text[:200])
            except (json.JSONDecodeError, ValueError):
                raise ApiError(resp.status_code, resp.text[:200])
        if not resp.content:
            return {}
        return resp.json()

    # ---------- 扫码 ----------

    def create_qr(self, platform: str = QR_PLATFORM) -> dict:
        resp = self.http.post(f"/uc/api/v1/qrcode/{platform}",
                              headers=self._headers())
        return self._unwrap(self._parse(resp))

    def qr_status(self, scene_id: str, platform: str = QR_PLATFORM) -> dict:
        resp = self.http.get(f"/uc/api/v1/qrcode/{platform}",
                             params={"scene_id": scene_id},
                             headers=self._headers())
        return self._unwrap(self._parse(resp))

    def exchange_qr(self, scene_id: str, platform: str = QR_PLATFORM) -> dict:
        resp = self.http.post(
            f"/api/v1/user/oauth/login/qrcode/{platform}",
            params={"scene_id": scene_id}, headers=self._headers())
        return self._unwrap(self._parse(resp))

    # ---------- 短信 ----------

    def send_sms_code(self, mobile: str, captcha: dict) -> dict:
        body = {
            "mobile": mobile,
            "biz_enum": "LOGIN",
            "captcha_id": captcha.get("captcha_id", ""),
            "token": captcha.get("token", ""),
            "authenticate": captcha.get("authenticate", ""),
            "validate": captcha.get("validate", ""),
        }
        resp = self.http.post("/api/v1/user/sms/send/codeByBiz", json=body,
                              headers=self._headers())
        return self._unwrap(self._parse(resp))

    def login_mobile(self, mobile: str, code: str, mask: str = "") -> dict:
        resp = self.http.post(
            "/api/v1/user/oauth/login/mobile",
            content=f"mobile={mobile}&verification_code={code}&mask={mask}",
            headers=self._headers({
                "content-type": "application/x-www-form-urlencoded"}),
        )
        return self._unwrap(self._parse(resp))

    # ---------- 密码 ----------

    def login_password(self, username: str, password: str, captcha: dict) -> dict:
        resp = self.http.post(
            "/api/v1/user/oauth/login",
            data={
                "username": username,
                "password": encrypt_password(password),
                "captcha_id": captcha.get("captcha_id", ""),
                "token": captcha.get("token", ""),
                "authenticate": captcha.get("authenticate", ""),
                "validate": captcha.get("validate", ""),
            },
            headers=self._headers({
                "content-type": "application/x-www-form-urlencoded"}),
        )
        return self._unwrap(self._parse(resp))

    @staticmethod
    def _unwrap(body: dict) -> dict:
        """axios 风格 {data: {...}} 双层包裹归一。"""
        data = body.get("data")
        return data if isinstance(data, dict) else body
