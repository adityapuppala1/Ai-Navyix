import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';
const ID = '[0-9a-fA-F-]{36}';
const ROUTE = new RegExp(`^/v1/orgs/(${ID})/projects/(${ID})/github-observations(?:/(${ID}))?$`);
async function body(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity'))
    throw new ApiError(415, 'CONTENT_TYPE', 'Use uncompressed JSON.');
  const length = req.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length)>4096)) throw new ApiError(413, 'TOO_LARGE', 'Capture requests are limited to 4 KB.');
  const parts = []; let size = 0;
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = error => { if(done) return; done=true; clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', failed); if(error){req.resume();reject(error);}else resolve(); };
    const data = chunk => { size+=chunk.length; if(size>4096)finish(new ApiError(413,'TOO_LARGE','Capture requests are limited to 4 KB.'));else parts.push(chunk); };
    const end = () => finish();
    const failed = () => finish(new ApiError(400,'INVALID_BODY','Request was interrupted.'));
    const timer = setTimeout(()=>finish(new ApiError(408,'TIMEOUT','Request body timed out.')),5000);
    req.on('data',data);req.on('end',end);req.on('error',failed);req.on('aborted',failed);
  });
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new ApiError(400,'INVALID_JSON','Use a valid JSON object.');}
}
/** Mount before the existing workflow middleware; unrelated routes fall through unchanged. */
export function createEvidenceJournalHandler({ service, authenticate, onError = () => {} }) {
  return async (req,res,next = () => {}) => {
    const url = new URL(req.originalUrl || req.url,'http://navyix.internal');
    if (!url.pathname.includes('/github-observations')) return next();
    const requestId=randomUUID();
    const send=(status,value)=>{ if(!res.destroyed&&!res.writableEnded){res.statusCode=status;res.end(JSON.stringify(value));} };
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Request-Id',requestId);
    try {
      const duplicates=(req.rawHeaders||[]).filter((_,i)=>i%2===0).filter(k=>k.toLowerCase()==='authorization').length;
      if(duplicates>1)throw new ApiError(401,'UNAUTHENTICATED','One access token is required.');
      const principal=await authenticate(req.headers.authorization), match=ROUTE.exec(url.pathname);
      if(!match)throw new ApiError(404,'NOT_FOUND','Unknown evidence history route.');
      const [,orgId,projectId,id]=match;
      const allowed=id?['GET']:['GET','POST'];
      if(!allowed.includes(req.method)){res.setHeader('Allow',allowed.join(', '));throw new ApiError(405,'METHOD_NOT_ALLOWED','Method not allowed.');}
      const keys=[...url.searchParams.keys()], permitted=req.method==='GET'&&!id?['after','limit']:[];
      if(new Set(keys).size!==keys.length||keys.some(k=>!permitted.includes(k)))throw new ApiError(400,'INVALID_QUERY','Unexpected or repeated query parameter.');
      if(req.method==='POST')return send(201,await service.capture(principal,orgId,projectId,await body(req),req.headers['idempotency-key']));
      if(id)return send(200,await service.get(principal,orgId,projectId,id));
      const limit=url.searchParams.get('limit');
      if(limit!==null&&!/^(?:[1-9]|1\d|20)$/.test(limit))throw new ApiError(400,'INVALID_QUERY','Limit must be 1–20.');
      return send(200,await service.list(principal,orgId,projectId,{after:url.searchParams.get('after')??undefined,limit:limit===null?20:Number(limit)}));
    } catch(error) {
      if(error instanceof ApiError)return send(error.status,{error:{code:error.code,message:error.message,requestId}});
      try{onError({requestId,code:'INTERNAL_ERROR'});}catch{/* Never log database errors or provider secrets. */}
      return send(500,{error:{code:'INTERNAL_ERROR',message:'Evidence history is unavailable.',requestId}});
    }
  };
}
