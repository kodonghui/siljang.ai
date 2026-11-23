/** 원격 개발의 루프백 주소에서만 시험한다. 이 Worker는 배포하지 않는다. */
export default {
  async fetch(request, env) {
    const mode = new URL(request.url).pathname.slice(1);
    if (mode === "ready") return Response.json({ ready: true });
    if (!["direct49", "direct51", "peer51", "peer30twice"].includes(mode)) {
      return new Response(null, { status: 404 });
    }
    return Response.json(await env.HARNESS.run(mode));
  },
};
