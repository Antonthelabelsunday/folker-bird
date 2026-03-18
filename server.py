#!/usr/bin/env python3
"""Static file server with Range request support (required for HTML5 video)."""
import http.server, os, sys

class RangeHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isfile(path):
            range_header = self.headers.get('Range')
            if range_header:
                return self._send_range(path, range_header)
        return super().send_head()

    def _send_range(self, path, range_header):
        size = os.path.getsize(path)
        # Parse "bytes=start-end"
        try:
            byte_range = range_header.strip().replace('bytes=', '')
            start_str, end_str = byte_range.split('-')
            start = int(start_str) if start_str else 0
            end   = int(end_str)   if end_str   else size - 1
        except Exception:
            self.send_error(400, 'Bad Range header')
            return None
        end = min(end, size - 1)
        length = end - start + 1
        ctype = self.guess_type(path)
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404)
            return None
        self.send_response(206)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        f.seek(start)
        remaining = length
        while remaining:
            chunk = f.read(min(65536, remaining))
            if not chunk:
                break
            self.wfile.write(chunk)
            remaining -= len(chunk)
        f.close()
        return None

    def log_message(self, fmt, *args):
        pass  # Silence request logs

port = int(sys.argv[1]) if len(sys.argv) > 1 else 9876
os.chdir(os.path.dirname(os.path.abspath(__file__)))
with http.server.HTTPServer(('', port), RangeHandler) as httpd:
    print(f'Serving on http://localhost:{port}')
    httpd.serve_forever()
