#!/usr/bin/env python3
"""GREENWAVE test harness (Step 8D) — tiny static server with CORS.

Serves one directory over HTTP with `Access-Control-Allow-Origin: *` so the
browser preview can fetch the local traffic MP4 as a blob. This is NOT part of
the application; it exists only to verify the camera panel end-to-end.
"""
import http.server
import os
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8321


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()