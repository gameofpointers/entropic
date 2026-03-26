import argparse
import json
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from catalog import ModelManager, snapshot_json


class RuntimeManager:
    def __init__(self, models_dir: str, state_dir: str):
        self.models_dir = Path(models_dir)
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.manager = ModelManager(str(self.models_dir))
        self.lock = threading.RLock()
        self.active_engine = None
        self.loaded_model: Optional[str] = None
        self.last_error: Optional[str] = None

    def _build_engine(self, architecture: str):
        if architecture == "rwkv":
            self.manager.ensure_rwkv_tokenizer()
            from rwkv_engine import RWKVEngine

            return RWKVEngine(str(self.manager.tokenizer_path()))
        if architecture == "mamba":
            from mamba_engine import MambaEngine

            return MambaEngine()
        from hf_engine import HFEngine

        return HFEngine()

    def health(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "ok": True,
                "loadedModel": self.loaded_model,
                "lastError": self.last_error,
            }

    def catalog_snapshot(self) -> Dict[str, Any]:
        with self.lock:
            payload = snapshot_json(self.manager, self.loaded_model)
            payload["lastError"] = self.last_error
            return payload

    def _load_model_unlocked(self, model_name: str) -> Dict[str, Any]:
        local_entry = self.manager.get_local_entry(model_name)
        if not local_entry:
            raise RuntimeError(f"Model not found: {model_name}")

        if self.active_engine and self.loaded_model == local_entry["name"]:
            return {
                "status": "already_loaded",
                "model": self.loaded_model,
            }

        if self.active_engine is not None:
            try:
                self.active_engine.unload()
            finally:
                self.active_engine = None
                self.loaded_model = None

        engine = self._build_engine(local_entry["architecture"])
        info = engine.load(local_entry["path"])
        self.active_engine = engine
        self.loaded_model = local_entry["name"]
        self.last_error = None
        return {
            "status": "loaded",
            "model": self.loaded_model,
            "info": info,
        }

    def load_model(self, model_name: str) -> Dict[str, Any]:
        with self.lock:
            return self._load_model_unlocked(model_name)

    def unload_model(self) -> Dict[str, Any]:
        with self.lock:
            if self.active_engine is None:
                return {"status": "no_model_loaded"}
            name = self.loaded_model
            self.active_engine.unload()
            self.active_engine = None
            self.loaded_model = None
            return {"status": "unloaded", "model": name}

    def delete_model(self, model_name: str) -> Dict[str, Any]:
        with self.lock:
            if self.loaded_model == model_name and self.active_engine is not None:
                self.active_engine.unload()
                self.active_engine = None
                self.loaded_model = None
            result = self.manager.delete(model_name)
            if result.get("status") == "error":
                self.last_error = result.get("error")
            return result

    def download_model(self, catalog_id: str, token: Optional[str] = None) -> Dict[str, Any]:
        with self.lock:
            result = self.manager.download(catalog_id, token)
            if result.get("status") == "error":
                self.last_error = result.get("error")
            else:
                self.last_error = None
            return result

    def warm_model(self, model_name: Optional[str] = None) -> Dict[str, Any]:
        with self.lock:
            if model_name:
                self._load_model_unlocked(model_name)
            if self.active_engine is None:
                return {"status": "error", "error": "No model loaded"}
            started_at = time.time()
            for _ in self.active_engine.generate_stream("User: Hi\n\nAssistant:", max_tokens=1):
                pass
            if hasattr(self.active_engine, "reset"):
                self.active_engine.reset()
            return {"status": "warm", "elapsed_s": round(time.time() - started_at, 2)}

    def _extract_content_text(self, content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: List[str] = []
            for block in content:
                if isinstance(block, dict):
                    block_type = str(block.get("type") or "").strip().lower()
                    if block_type in {"text", "input_text", ""}:
                        text = block.get("text")
                        if isinstance(text, str) and text.strip():
                            parts.append(text.strip())
                elif isinstance(block, str) and block.strip():
                    parts.append(block.strip())
            return "\n".join(parts)
        if isinstance(content, dict):
            text = content.get("text")
            if isinstance(text, str):
                return text
        return ""

    def _build_prompt(self, messages: List[Dict[str, Any]], model_name: str) -> str:
        local_entry = self.manager.get_local_entry(model_name)
        thinking = bool(local_entry and local_entry.get("thinking"))
        system_messages: List[str] = []
        transcript: List[str] = []

        for message in messages:
            role = str(message.get("role") or "").strip().lower() or "user"
            text = self._extract_content_text(message.get("content"))
            if not text.strip():
                continue
            if role == "system":
                system_messages.append(text.strip())
                continue
            if role == "assistant":
                transcript.append(f"Assistant: {text.strip()}")
                continue
            if role == "tool":
                transcript.append(f"Tool: {text.strip()}")
                continue
            transcript.append(f"User: {text.strip()}")

        prompt = ""
        if system_messages:
            prompt += "\n\n".join(system_messages).strip() + "\n\n"
        if transcript:
            prompt += "\n\n".join(transcript).strip() + "\n\n"
        prompt += "Assistant: <think\n" if thinking else "Assistant:"
        return prompt

    def generate(
        self,
        model_name: str,
        messages: List[Dict[str, Any]],
        temperature: float,
        top_p: float,
        max_tokens: int,
    ):
        with self.lock:
            self._load_model_unlocked(model_name)
            prompt = self._build_prompt(messages, model_name)
            engine = self.active_engine
            if hasattr(engine, "reset"):
                engine.reset()
        for piece in engine.generate_stream(
            prompt,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
        ):
            yield piece


def make_handler(runtime: RuntimeManager):
    class Handler(BaseHTTPRequestHandler):
        server_version = "EntropicRnnRuntime/0.1"

        def _json_response(self, status: int, payload: Dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json_body(self) -> Dict[str, Any]:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(content_length) if content_length else b"{}"
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))

        def _handle_chat_completions(self) -> None:
            body = self._read_json_body()
            model_name = str(body.get("model") or "").strip()
            if not model_name:
                self._json_response(400, {"error": {"message": "Missing model"}})
                return

            messages = body.get("messages") if isinstance(body.get("messages"), list) else []
            temperature = float(body.get("temperature") or 1.0)
            top_p = float(body.get("top_p") or 0.7)
            max_tokens = int(body.get("max_tokens") or body.get("max_completion_tokens") or 500)
            stream = bool(body.get("stream"))

            try:
                chunks = runtime.generate(model_name, messages, temperature, top_p, max_tokens)
            except Exception as error:
                self._json_response(500, {"error": {"message": str(error)}})
                return

            completion_id = f"chatcmpl-{uuid4().hex}"
            created = int(time.time())

            if not stream:
                parts = []
                try:
                    for chunk in chunks:
                        parts.append(chunk)
                except Exception as error:
                    self._json_response(500, {"error": {"message": str(error)}})
                    return
                text = "".join(parts)
                self._json_response(
                    200,
                    {
                        "id": completion_id,
                        "object": "chat.completion",
                        "created": created,
                        "model": model_name,
                        "choices": [
                            {
                                "index": 0,
                                "message": {"role": "assistant", "content": text},
                                "finish_reason": "stop",
                            }
                        ],
                    },
                )
                return

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            def send_event(payload: Dict[str, Any]) -> None:
                data = json.dumps(payload).encode("utf-8")
                self.wfile.write(b"data: " + data + b"\n\n")
                self.wfile.flush()

            try:
                send_event(
                    {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model_name,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {"role": "assistant"},
                                "finish_reason": None,
                            }
                        ],
                    }
                )
                for piece in chunks:
                    send_event(
                        {
                            "id": completion_id,
                            "object": "chat.completion.chunk",
                            "created": created,
                            "model": model_name,
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {"content": piece},
                                    "finish_reason": None,
                                }
                            ],
                        }
                    )
                send_event(
                    {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model_name,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {},
                                "finish_reason": "stop",
                            }
                        ],
                    }
                )
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except Exception as error:
                send_event(
                    {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model_name,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {},
                                "finish_reason": "error",
                            }
                        ],
                        "error": {"message": str(error)},
                    }
                )
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()

        def do_GET(self) -> None:
            if self.path == "/healthz":
                self._json_response(200, runtime.health())
                return
            if self.path == "/v1/models":
                snapshot = runtime.catalog_snapshot()
                self._json_response(
                    200,
                    {
                        "object": "list",
                        "data": [
                            {
                                "id": entry["name"],
                                "object": "model",
                                "owned_by": "entropic-rnn",
                            }
                            for entry in snapshot["local"]
                        ],
                    },
                )
                return
            if self.path == "/api/rnn/catalog":
                self._json_response(200, runtime.catalog_snapshot())
                return
            self._json_response(404, {"error": {"message": "Not found"}})

        def do_POST(self) -> None:
            if self.path == "/v1/chat/completions":
                self._handle_chat_completions()
                return

            body = self._read_json_body()
            token = str(body.get("hfToken") or "").strip() or None
            try:
                if self.path == "/api/rnn/models/download":
                    self._json_response(
                        200,
                        runtime.download_model(str(body.get("catalogId") or "").strip(), token),
                    )
                    return
                if self.path == "/api/rnn/models/load":
                    self._json_response(
                        200, runtime.load_model(str(body.get("modelName") or "").strip())
                    )
                    return
                if self.path == "/api/rnn/models/unload":
                    self._json_response(200, runtime.unload_model())
                    return
                if self.path == "/api/rnn/models/delete":
                    self._json_response(
                        200, runtime.delete_model(str(body.get("modelName") or "").strip())
                    )
                    return
                if self.path == "/api/rnn/models/warm":
                    model_name = str(body.get("modelName") or "").strip() or None
                    self._json_response(200, runtime.warm_model(model_name))
                    return
            except Exception as error:
                self._json_response(500, {"status": "error", "error": str(error)})
                return

            self._json_response(404, {"error": {"message": "Not found"}})

        def log_message(self, format: str, *args: Any) -> None:
            return None

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=11445)
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--state-dir", required=True)
    args = parser.parse_args()

    runtime = RuntimeManager(args.models_dir, args.state_dir)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(runtime))
    server.daemon_threads = True
    print(f"[entropic-rnn] listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
