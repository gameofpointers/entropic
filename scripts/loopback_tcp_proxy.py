#!/usr/bin/env python3
import argparse
import selectors
import socket
import socketserver
import sys
from typing import Optional


def log(message: str) -> None:
    print(f"[loopback-proxy] {message}", flush=True)


def forward_bidirectional(client: socket.socket, upstream: socket.socket) -> None:
    selector = selectors.DefaultSelector()
    selector.register(client, selectors.EVENT_READ, upstream)
    selector.register(upstream, selectors.EVENT_READ, client)
    sockets_open = 2

    try:
        while sockets_open > 0:
            for key, _ in selector.select():
                source: socket.socket = key.fileobj
                target: socket.socket = key.data
                try:
                    data = source.recv(65536)
                except OSError:
                    data = b""

                if not data:
                    try:
                        selector.unregister(source)
                    except Exception:
                        pass
                    sockets_open -= 1
                    try:
                        target.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass
                    continue

                try:
                    target.sendall(data)
                except OSError:
                    return
    finally:
        selector.close()


class ProxyServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def make_handler(target_host: str, target_port: int):
    class Handler(socketserver.BaseRequestHandler):
        def handle(self) -> None:
            upstream: Optional[socket.socket] = None
            try:
                upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                upstream.connect((target_host, target_port))
                forward_bidirectional(self.request, upstream)
            except Exception as error:
                log(f"proxy error from {self.client_address}: {error}")
            finally:
                if upstream is not None:
                    try:
                        upstream.close()
                    except OSError:
                        pass
                try:
                    self.request.close()
                except OSError:
                    pass

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--target-host", default="127.0.0.1")
    parser.add_argument("--target-port", type=int, required=True)
    args = parser.parse_args()

    server = ProxyServer(
        (args.listen_host, args.listen_port),
        make_handler(args.target_host, args.target_port),
    )
    log(
        f"listening on tcp://{args.listen_host}:{args.listen_port} -> "
        f"tcp://{args.target_host}:{args.target_port}"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
