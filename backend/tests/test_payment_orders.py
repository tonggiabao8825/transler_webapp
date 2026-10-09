"""Single pending checkout lifecycle against the real Node API and PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest
from conftest import ApiClient
from sqlalchemy import text
from test_accounts import register

pytestmark = pytest.mark.integration


def test_one_pending_order_cancel_expire_and_late_transfer(client: ApiClient) -> None:
    register(client)
    request = {
        "plan_code": "pro",
        "provider": "sepay",
        "request_id": str(uuid4()),
        "billing_cycle": "monthly",
    }
    cookies = dict(client.cookies)
    base_url = str(client.base_url)

    def checkout(request_id: str) -> httpx.Response:
        with httpx.Client(base_url=base_url, cookies=cookies) as browser:
            return browser.post("/v1/billing/checkout", json={**request, "request_id": request_id})

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(checkout, [request["request_id"], str(uuid4())]))
        assert sorted(response.status_code for response in responses) == [201, 409]
        response = next(response for response in responses if response.status_code == 201)
        blocked = next(response for response in responses if response.status_code == 409)
        assert blocked.json()["code"] == "PAYMENT_ORDER_PENDING"
        order = response.json()["order"]
        assert response.json()["qr_url"]
        with httpx.Client(base_url=base_url) as stranger:
            assert stranger.post("/v1/session").status_code == 200
            registered = stranger.post(
                "/v1/auth/register",
                json={
                    "email": f"stranger-{uuid4()}@example.com",
                    "name": "Stranger",
                    "password": "transler-integration-password-2026",
                },
            )
            assert registered.status_code == 201
            assert stranger.post(f"/v1/billing/orders/{order['id']}/cancel").status_code == 404
        cancelled = client.post(f"/v1/billing/orders/{order['id']}/cancel")
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["order"]["status"] == "CANCELLED"
        assert cancelled.json()["qr_url"] is None
        assert client.post(f"/v1/billing/orders/{order['id']}/cancel").status_code == 200
        next_order = client.post(
            "/v1/billing/checkout", json={**request, "request_id": str(uuid4())}
        )
        assert next_order.status_code == 201, next_order.text
        next_id = next_order.json()["order"]["id"]
        headers = {"Authorization": "Apikey integration-sepay-secret-32-characters"}
        payment = client.post(
            "/v1/billing/webhooks/sepay",
            headers=headers,
            json={
                "id": int(uuid4().int % 1000000000) + 1,
                "accountNumber": "123456789",
                "transferType": "in",
                "transferAmount": order["amount"],
                "content": order["reference"],
                "transactionDate": datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime(
                    "%Y-%m-%d %H:%M:%S"
                ),
            },
        )
        assert payment.status_code == 200 and not payment.json()["processed"], payment.text
        assert client.get(f"/v1/billing/orders/{order['id']}").json()["order"]["status"] == "REVIEW"
        assert client.get("/v1/account").json()["plan"]["code"] == "free"
        with client.database.begin() as connection:
            connection.execute(
                text("UPDATE payment_orders SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:id"),
                {"id": UUID(next_id)},
            )
        expired = client.get(f"/v1/billing/orders/{next_id}")
        assert expired.json()["order"]["status"] == "EXPIRED"
        assert expired.json()["qr_url"] is None
        final_order = client.post(
            "/v1/billing/checkout", json={**request, "request_id": str(uuid4())}
        )
        assert final_order.status_code == 201, final_order.text
        assert (
            client.post(
                f"/v1/billing/orders/{final_order.json()['order']['id']}/cancel"
            ).status_code
            == 200
        )
    finally:
        for remaining in client.get("/v1/billing/orders").json():
            if remaining["status"] == "PENDING":
                client.post(f"/v1/billing/orders/{remaining['id']}/cancel").raise_for_status()
