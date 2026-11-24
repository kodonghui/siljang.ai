import { expect, it } from "vitest";
import { supabaseAuth } from "../src/operator-auth";
import { Secret } from "../src/settings";
import { SupabaseMock, testPublishableKey } from "./support/supabase-mock";

function harness(replacement: unknown, omit = false) {
  const key = testPublishableKey(),
    mock = new SupabaseMock(key);
  mock.omitFactorsOnSignIn = true;
  const user = mock.addUser("mvp-operator-20261124@example.com", "not-real-synthetic-password", null);
  const auth = supabaseAuth(
    { url: "https://synthetic.supabase.example", publishableKey: new Secret(key) },
    {
      fetch: async (input, init) => {
        const response = await mock.fetch(input, init);
        if (new URL(String(input)).pathname.endsWith("/user") && response.ok) {
          const body = (await response.json()) as Record<string, unknown>;
          if (omit) delete body.factors;
          else body.factors = replacement;
          return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
        }
        return response;
      },
    },
  );
  return { auth, user };
}
it("확인된 GET user의 factors 생략은 빈 목록이며 로그인 응답 생략과 구분", async () => {
  const { auth, user } = harness(undefined, true);
  const session = await auth.signInWithPassword(user.email, user.password);
  expect(session?.user.factors).toBeNull();
  expect(await auth.getUser(session?.accessToken ?? "")).toMatchObject({ id: user.id, email: user.email, factors: [] });
});
it.each([null, {}, "invalid"])("GET user의 잘못된 factors 형식은 빈 목록으로 받지 않음(%j)", async (bad) => {
  const { auth, user } = harness(bad);
  const session = await auth.signInWithPassword(user.email, user.password);
  await expect(auth.getUser(session?.accessToken ?? "")).rejects.toMatchObject({ reason: "shape" });
});
