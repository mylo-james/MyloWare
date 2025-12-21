from myloware.api.routes import webhooks
from hypothesis import given, settings, strategies as st


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
    payload=st.binary(max_size=2048),
    secret=st.text(min_size=1, max_size=256),
)
@settings(deadline=None)
def test_verify_webhook_signature_property(payload, secret):
    import hashlib
    import hmac

    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    assert webhooks._verify_webhook_signature(payload, f"sha256={expected}", secret, "test")
