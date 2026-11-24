import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,extname,sep} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=resolve(root,'.'+(p==='/'||p==='/owner'||p.startsWith('/owner/')?'/index.html':p));if(!target.startsWith(root+sep)||!mime[extname(target)]){res.writeHead(404);res.end();return;}const data=await readFile(target);res.writeHead(200,{'Content-Type':mime[extname(target)],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'none'; frame-ancestors 'none'"});res.end(data);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1',()=>console.log('QA054_READY_'+server.address().port));
