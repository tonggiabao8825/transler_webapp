"""ASGI boundary rejects oversized bodies before multipart spooling."""

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestLimits:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        size = 0

        async def receive_limited() -> Message:
            nonlocal size
            message = await receive()
            if message["type"] == "http.request":
                size += len(message.get("body", b""))
                if size > self.max_bytes:
                    raise HTTPException(413, "Request body exceeds the upload limit.")
            return message

        async def send_private(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if not any(key == b"cache-control" for key, _ in headers):
                    headers.append((b"cache-control", b"private, no-store"))
                headers.append((b"x-content-type-options", b"nosniff"))
                await send({**message, "headers": headers})
            else:
                await send(message)

        await self.app(scope, receive_limited, send_private)
