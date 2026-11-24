import { kakaoOwnerAuth } from '../../../../app/server/src/owner-auth.ts';
import { readSettings } from '../../../../app/server/src/settings.ts';
export default { async fetch(request) {
 if (new URL(request.url).pathname === '/adapter') {
  const settings = readSettings({KAKAO_REST_API_KEY:'synthetic-client',KAKAO_CLIENT_SECRET:'synthetic-secret',KAKAO_OWNER_REDIRECT_URIS:'https://siljang.example/owner/login/callback'}).ownerAuth;
  const auth=kakaoOwnerAuth(settings,{fetch:(_url,init)=>fetch('http://127.0.0.1:18761/token',init)});
  try { const owner=await auth.signIn('synthetic-code','https://siljang.example/owner/login/callback','synthetic-verifier');return Response.json({result:owner===null?'rejected':'signed_in'}); }
  catch(error) { return Response.json({result:'unavailable',errorName:error.name}); }
 }

 const results=[];
 for (const mode of ['error','manual','follow']) {
  try {
   const request = new Request('http://127.0.0.1:18761/token',{method:'POST',redirect:mode,body:'synthetic=1'});
   const response = await fetch(request);
   results.push({mode,status:response.status});
   await response.body?.cancel();
  } catch(error) {
   results.push({mode,errorName:error.name,redirectMentioned:error.message.includes('redirect'),policyMentioned:error.message.includes('policy')});
  }
 }
 return Response.json(results);
}};
