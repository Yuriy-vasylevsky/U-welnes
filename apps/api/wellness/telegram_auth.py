"""Validate raw initData before authenticated booking operations.
Client-supplied identity is never trusted without signature and age checks.
Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""
import hashlib
import hmac
import time
from urllib.parse import parse_qsl

def validate_init_data(raw: str, token: str, *, max_age: int = 3600, now: int | None = None) -> dict[str, str]:
    if not token or max_age <= 0:
        raise ValueError("Token and a positive max_age are required")
    try:
        pairs = parse_qsl(raw, strict_parsing=True, max_num_fields=100)
        data = dict(pairs)
        if len(data) != len(pairs):
            raise ValueError("Duplicate fields")
        supplied_hash = data.pop("hash")
        check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
        secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, supplied_hash):
            raise ValueError("Invalid signature")
        age = (int(time.time()) if now is None else now) - int(data["auth_date"])
        if age < -30 or age > max_age:
            raise ValueError("Expired or future auth_date")
        return data
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid Telegram initData") from exc
