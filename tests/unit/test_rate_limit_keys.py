from fastapi import Request

from myloware.api.rate_limit import key_api_key_or_ip


class DummyRequest(Request):
    def __init__(self, headers: dict[str, str], client: tuple[str, int] = ("127.0.0.1", 1234)):
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": client,
        }
        super().__init__(scope)


def test_same_api_key_same_bucket():
    req1 = DummyRequest({"X-API-Key": "abc"})
    req2 = DummyRequest({"X-API-Key": "abc"})
    assert key_api_key_or_ip(req1) == key_api_key_or_ip(req2)


def test_different_api_keys_different_buckets():
    req1 = DummyRequest({"X-API-Key": "abc"})
    req2 = DummyRequest({"X-API-Key": "def"})
    assert key_api_key_or_ip(req1) != key_api_key_or_ip(req2)


def test_ip_fallback_stable():
    req1 = DummyRequest({})
    req2 = DummyRequest({}, client=("10.0.0.5", 1234))
    assert key_api_key_or_ip(req1) == "ip:127.0.0.1"
    assert key_api_key_or_ip(req2) == "ip:10.0.0.5"


def test_namespace_override():
    req = DummyRequest({"X-Rate-Limit-Namespace": "tenant-a"})
    assert key_api_key_or_ip(req) == "ns:tenant-a"


def test_auth_header_bucket():
    req = DummyRequest({"Authorization": "Bearer tok"})
    assert key_api_key_or_ip(req) == "auth:Bearer tok"
