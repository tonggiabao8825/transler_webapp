"""Account and payment integration through Node HTTP, PostgreSQL and signed webhooks."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
from conftest import ApiClient
from sqlalchemy import text

pytestmark = pytest.mark.integration
PASSWORD = "transler-integration-password-2026"


def register(client: ApiClient) -> dict[str, str]:
    email = f"integration-{uuid4()}@example.com"
    response = client.post(
        "/v1/auth/register", json={"email": email, "name": "Integration User", "password": PASSWORD}
    )
    assert response.status_code == 201, response.text
    account = response.json()
    assert "password_hash" not in account
    assert account["role"] == "user"
    return {"id": account["id"], "email": email, "workspace_id": account["workspace_id"]}


def test_registration_ownership_profile_and_password(client: ApiClient, pdf: bytes) -> None:
    source = client.post("/v1/documents", files={"file": ("kept.pdf", pdf, "application/pdf")})
    assert source.status_code == 201, source.text
    owner = client.post("/v1/session").json()["owner_id"]
    old_guest_cookie = client.cookies.get("transler_session")
    account = register(client)
    assert account["workspace_id"] == owner
    assert client.get("/v1/documents").json()[0]["id"] == source.json()["id"]
    with httpx.Client(base_url=str(client.base_url)) as stranger:
        stranger.cookies.set("transler_session", old_guest_cookie)
        assert stranger.get("/v1/documents").status_code == 401
        assert (
            stranger.post(
                "/v1/auth/login", json={"email": account["email"], "password": PASSWORD}
            ).status_code
            == 200
        )
        assert stranger.get("/v1/documents").status_code == 200
        assert client.get("/v1/admin/overview").status_code == 403
        profile = client.get("/v1/account").json()
        assert len(profile["daily"]) == 30
        assert profile["usage"]["documents"] == 1
        assert profile["plan"]["code"] == "free"
        assert client.patch("/v1/account", json={"name": "Updated Name"}).status_code == 200
        report = client.get("/v1/account/report")
        assert report.status_code == 200 and "text/csv" in report.headers["content-type"]
        changed = client.post(
            "/v1/account/password",
            json={"current_password": PASSWORD, "new_password": PASSWORD + "new"},
        )
        assert changed.status_code == 204, changed.text
        assert stranger.get("/v1/account").status_code == 401
    assert (
        client.post(
            "/v1/auth/login", json={"email": account["email"], "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/v1/auth/login", json={"email": account["email"], "password": PASSWORD + "new"}
        ).status_code
        == 200
    )


def test_admin_catalog_verified_payment_and_idempotency(client: ApiClient) -> None:
    account = register(client)
    with client.database.begin() as connection:
        connection.execute(
            text("UPDATE accounts SET role='admin' WHERE id=:id"), {"id": UUID(account["id"])}
        )
    assert client.get("/v1/admin/overview").status_code == 200
    assert client.get("/v1/admin/accounts?offset=0&limit=50").status_code == 200
    gateways = client.get("/v1/admin/gateways")
    assert gateways.status_code == 200, gateways.text
    receiving = next(item for item in gateways.json() if item["provider"] == "sepay")
    assert receiving["has_webhook_key"] and "encrypted_secrets" not in receiving
    gateway_update = {
        "enabled": True,
        "settings": receiving["settings"],
        "secrets": {"webhook_key": "integration-sepay-secret-32-characters"},
    }
    configured = client.put("/v1/admin/gateways/sepay", json=gateway_update)
    assert configured.status_code == 200 and configured.json()["ready"], configured.text
    assert "integration-sepay-secret-32-characters" not in configured.text
    with client.database.connect() as connection:
        encrypted = connection.scalar(
            text("SELECT encrypted_secrets FROM provider_settings WHERE provider='sepay'")
        )
    assert isinstance(encrypted, str) and "integration-sepay-secret-32-characters" not in encrypted
    plan = next(plan for plan in client.get("/v1/admin/plans").json() if plan["code"] == "pro")
    body = {key: value for key, value in plan.items() if key != "code"}
    body["price_vnd"] = 100000
    body["yearly_price_vnd"] = 900000
    assert client.put("/v1/admin/plans/pro", json=body).status_code == 200
    request = {
        "plan_code": "pro",
        "provider": "sepay",
        "request_id": str(uuid4()),
        "billing_cycle": "monthly",
    }
    response = client.post("/v1/billing/checkout", json=request)
    assert response.status_code == 201, response.text
    order = response.json()["order"]
    assert order["billing_cycle"] == "monthly" and order["duration_days"] == 30
    assert response.json()["bank_account"] == "123456789"
    blocked = client.put("/v1/admin/gateways/sepay", json=gateway_update)
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["code"] == "GATEWAY_HAS_PENDING_ORDERS"
    assert client.post("/v1/billing/checkout", json=request).json()["order"]["id"] == order["id"]
    payload = {
        "id": int(uuid4().int % 1000000000) + 1,
        "accountNumber": "123456789",
        "transferType": "in",
        "transferAmount": 100000,
        "content": order["reference"],
        "transactionDate": datetime.now(UTC).astimezone().isoformat(),
    }
    from zoneinfo import ZoneInfo

    payload["transactionDate"] = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    assert client.post("/v1/billing/webhooks/sepay", json=payload).status_code == 401
    headers = {"Authorization": "Apikey integration-sepay-secret-32-characters"}
    result = client.post("/v1/billing/webhooks/sepay", json=payload, headers=headers)
    assert result.status_code == 200 and result.json()["processed"], result.text
    first_expiry = client.get("/v1/account").json()["account"]["plan_expires_at"]
    assert client.get("/v1/account").json()["plan"]["code"] == "pro"
    assert client.post("/v1/billing/webhooks/sepay", json=payload, headers=headers).json()[
        "processed"
    ]
    assert client.get("/v1/account").json()["account"]["plan_expires_at"] == first_expiry
    assert (
        client.post(
            "/v1/billing/webhooks/sepay", json={**payload, "transferAmount": 99999}, headers=headers
        ).status_code
        == 409
    )
    assert client.get(f"/v1/billing/orders/{order['id']}").json()["order"]["status"] == "PAID"
    annual_request = {**request, "request_id": str(uuid4()), "billing_cycle": "yearly"}
    conflict = client.post("/v1/billing/checkout", json={**request, "billing_cycle": "yearly"})
    assert conflict.status_code == 409, conflict.text
    annual_checkout = client.post("/v1/billing/checkout", json=annual_request)
    assert annual_checkout.status_code == 201, annual_checkout.text
    annual_order = annual_checkout.json()["order"]
    assert annual_order["billing_cycle"] == "yearly"
    assert annual_order["amount"] == 900000 and annual_order["duration_days"] == 365
    body["yearly_price_vnd"] = 950000
    assert client.put("/v1/admin/plans/pro", json=body).status_code == 200
    settled = client.post(
        "/v1/billing/webhooks/sepay",
        json={
            **payload,
            "id": payload["id"] + 1,
            "content": annual_order["reference"],
            "transferAmount": 900000,
        },
        headers=headers,
    )
    assert settled.status_code == 200 and settled.json()["processed"], settled.text
    annual_expiry = client.get("/v1/account").json()["account"]["plan_expires_at"]
    assert (
        datetime.fromisoformat(annual_expiry) - datetime.fromisoformat(first_expiry)
    ).days == 365
    with httpx.Client(base_url=str(client.base_url)) as stranger:
        assert stranger.post("/v1/session").status_code == 200
        registered = stranger.post(
            "/v1/auth/register",
            json={
                "email": f"stranger-{uuid4()}@example.com",
                "name": "Stranger",
                "password": PASSWORD,
            },
        )
        assert registered.status_code == 201
        assert stranger.get(f"/v1/billing/orders/{order['id']}").status_code == 404
        assert stranger.get("/v1/admin/report").status_code == 403
    assert client.get("/v1/admin/payment-events?offset=0&limit=50").status_code == 200
    assert client.get("/v1/admin/audit?offset=0&limit=50").status_code == 200


def test_stripe_signature_settlement_and_review(client: ApiClient) -> None:
    import hashlib
    import hmac
    import json
    import time

    account = register(client)
    order_id = uuid4()
    reference = "TL" + order_id.hex.upper()
    checkout_id = "cs_integration_" + uuid4().hex
    with client.database.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO payment_orders(id,account_id,request_id,plan_code,provider,"
                "amount,currency,duration_days,reference,checkout_id,status,created_at,expires_at) "
                "VALUES(:id,:account,:request,'pro','card',1000,'usd',30,:reference,"
                ":checkout,'PENDING',NOW(),NOW()+INTERVAL '1 hour')"
            ),
            {
                "id": order_id,
                "account": UUID(account["id"]),
                "request": uuid4(),
                "reference": reference,
                "checkout": checkout_id,
            },
        )
    event = {
        "id": f"evt_{uuid4().hex}",
        "type": "checkout.session.completed",
        "created": int(time.time()),
        "data": {
            "object": {
                "id": checkout_id,
                "client_reference_id": str(order_id),
                "amount_total": 999,
                "currency": "usd",
                "payment_status": "paid",
            }
        },
    }
    payload = json.dumps(event)
    timestamp = int(time.time())
    digest = hmac.new(
        b"integration-stripe-signing-secret-32-characters",
        f"{timestamp}.{payload}".encode(),
        hashlib.sha256,
    ).hexdigest()
    headers = {"Content-Type": "application/json", "stripe-signature": f"t={timestamp},v1={digest}"}
    wrong = client.post(
        "/v1/billing/webhooks/stripe",
        content=payload,
        headers={**headers, "stripe-signature": f"t={timestamp},v1={'0' * 64}"},
    )
    assert wrong.status_code == 400
    response = client.post("/v1/billing/webhooks/stripe", content=payload, headers=headers)
    assert response.status_code == 200 and not response.json()["processed"], response.text
    assert client.get(f"/v1/billing/orders/{order_id}").json()["order"]["status"] == "REVIEW"
    assert client.get("/v1/account").json()["plan"]["code"] == "free"
    assert client.post(f"/v1/admin/orders/{order_id}/confirm").status_code == 403
    with client.database.begin() as connection:
        connection.execute(
            text("UPDATE accounts SET role='admin' WHERE id=:id"), {"id": UUID(account["id"])}
        )
    assert client.post(f"/v1/admin/orders/{order_id}/confirm").status_code == 200
    assert client.get("/v1/account").json()["plan"]["code"] == "pro"
    assert client.post(f"/v1/admin/orders/{order_id}/confirm").status_code == 409
