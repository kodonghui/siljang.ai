from http.server import BaseHTTPRequestHandler,HTTPServer
class Handler(BaseHTTPRequestHandler):
 def do_POST(self):
  self.rfile.read(int(self.headers.get('Content-Length',0)));data=b'{"error":"synthetic_invalid_request"}';self.send_response(400);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def log_message(self,*args):pass
HTTPServer(('127.0.0.1',18761),Handler).serve_forever()
