import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..engine import engine

router = APIRouter()


@router.websocket("/ws/stream")
async def stream_ws(ws: WebSocket):
    await ws.accept()
    queue = engine.subscribe()
    try:
        while True:
            msg = await queue.get()
            await ws.send_text(json.dumps(msg))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        engine.unsubscribe(queue)
