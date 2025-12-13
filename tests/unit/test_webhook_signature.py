import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2] / "src"))

from api.routes import webhooks
from hypothesis import given, strategies as st


def test_verify_webhook_signature_valid():
    payload = b'{"ok":true}'
    secret = "topsecret"
    import hashlib
    import hmac

    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    assert webhooks._verify_webhook_signature(payload, f"sha256={expected}", secret, "test")


def test_verify_webhook_signature_invalid():
    payload = b'{"ok":true}'
    secret = "topsecret"
    assert not webhooks._verify_webhook_signature(payload, "sha256=bad", secret, "test")


@given(
    payload=st.binary(),
    secret=st.text(min_size=1),
)
def test_verify_webhook_signature_property(payload, secret):
    import hashlib
    import hmac

    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    assert webhooks._verify_webhook_signature(payload, f"sha256={expected}", secret, "test")
