/**
 * 운영자 등록 도구의 본체(TASK-021; 06 DEC-27, 05 TBL-002 R2). 명령은 operator-enroll-cli.ts.
 *
 * Supabase 대시보드에서 운영자 사용자(이메일·비밀번호)를 만든 뒤 운영자가 자기 터미널에서 한 번 돌린다:
 * 1. 숨긴 입력으로 비밀번호를 받아 Supabase에 로그인한다.
 * 2. 확인된 TOTP가 이미 있으면 지금 번호로 확인만 하고 3을 건너뛴다(다시 등록하려면 대시보드에서 그 인자를 지운 뒤 돌림).
 * 3. 확인 전 TOTP(지난번에 끝내지 못한 것)를 지우고 새로 등록한다. 비밀 글자와 otpauth 주소를 터미널에 한 번 보이고,
 *    인증 앱이 보여 주는 6자리 번호로 확인한다(challenge → verify).
 * 4. 우리 운영자 표(05 operators)에 그 이메일(소문자)의 행을 넣거나 이름을 고치고 mfa_enrolled_at을 채운다(새로 등록했으면
 *    지금, 이미 있던 TOTP면 비어 있을 때만). 막힌 계정
 *    (disabled_at)은 풀지 않는다.
 * 5. Supabase 세션을 끝낸다.
 * 비밀번호·번호·비밀 글자·토큰은 파일·로그·데이터베이스에 남기지 않는다. 비밀 글자는 3의 화면 한 번뿐이다.
 */
import type { Queryable } from "../src/db";
import type { OperatorAuth } from "../src/operator-auth";

export interface EnrollIo {
  /** 보이는 입력 한 줄. */
  ask(question: string): Promise<string>;
  /** 숨긴 입력 한 줄(비밀번호). */
  askHidden(question: string): Promise<string>;
  /** 터미널에 한 줄. */
  print(line: string): void;
}

export interface EnrollArgs {
  readonly email: string;
  readonly displayName: string;
}

export interface EnrollResult {
  readonly operatorId: string;
  /** new: 이번에 TOTP를 등록함. existing: 이미 있던 TOTP를 확인만 함. */
  readonly totp: "new" | "existing";
  readonly disabled: boolean;
}

/** 등록하지 못함. 메시지는 화면에 그대로 보여도 되는 말만(넣은 값 없음). */
export class EnrollError extends Error {
  override readonly name = "EnrollError";
}

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const OTP = /^[0-9]{6}$/;
const FACTOR_NAME = "siljang-operator";

export function checkArgs(args: EnrollArgs): EnrollArgs {
  const email = args.email.trim().toLowerCase();
  const displayName = args.displayName.trim();
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) throw new EnrollError("이메일 형식이 맞지 않아요");
  const n = [...displayName].length;
  if (n < 1 || n > 40) throw new EnrollError("이름은 1~40자예요");
  return { email, displayName };
}

/** 명령 인자: --email <이메일> --name <이름> 둘만(비밀번호는 인자로 받지 않음). 맞지 않으면 null. */
export function parseArgs(argv: readonly string[]): { email: string; displayName: string } | null {
  let email: string | null = null;
  let displayName: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--email" && v !== undefined) {
      email = v;
      i += 1;
    } else if (a === "--name" && v !== undefined) {
      displayName = v;
      i += 1;
    } else {
      return null;
    }
  }
  return email === null || displayName === null ? null : { email, displayName };
}

async function askCode(io: EnrollIo, question: string): Promise<string> {
  const code = (await io.ask(question)).trim();
  if (!OTP.test(code)) throw new EnrollError("번호는 숫자 6자리예요. 처음부터 다시 실행해 주세요");
  return code;
}

/** 도구 한 번. 실패하면 EnrollError(인증 서비스가 답하지 않으면 AuthUnavailableError). */
export async function enrollOperator(
  deps: { readonly auth: OperatorAuth; readonly db: Queryable; readonly now: () => Date; readonly io: EnrollIo },
  rawArgs: EnrollArgs,
): Promise<EnrollResult> {
  const { auth, db, io } = deps;
  const args = checkArgs(rawArgs);
  const password = await io.askHidden("Supabase 비밀번호(보이지 않음): ");
  const signedIn = await auth.signInWithPassword(args.email, password);
  if (signedIn === null)
    throw new EnrollError("로그인하지 못했어요. 이메일·비밀번호와 대시보드의 사용자를 확인해 주세요");
  let token = signedIn.accessToken;
  try {
    const user = await auth.getUser(token);
    if (user === null) throw new EnrollError("로그인하지 못했어요. 다시 실행해 주세요");
    const factors = (user.factors ?? []).filter((f) => f.type === "totp");
    const verified = factors.filter((f) => f.status === "verified");
    if (verified.length > 1) {
      throw new EnrollError("확인된 2단계 인증이 둘 이상이에요. 대시보드에서 하나만 남기고 다시 실행해 주세요");
    }
    let totp: "new" | "existing";
    if (verified.length === 1) {
      const code = await askCode(io, "이미 등록한 인증 앱의 6자리 번호: ");
      const upgraded = await auth.verifyTotp(token, (verified[0] as { id: string }).id, code);
      if (upgraded === null) throw new EnrollError("번호가 맞지 않아요. 처음부터 다시 실행해 주세요");
      token = upgraded;
      totp = "existing";
    } else {
      for (const f of factors) await auth.unenroll(token, f.id);
      const enrollment = await auth.enrollTotp(token, FACTOR_NAME);
      if (enrollment === null)
        throw new EnrollError("2단계 인증을 등록하지 못했어요. 대시보드에서 TOTP가 켜져 있는지 확인해 주세요");
      io.print(
        "인증 앱(예: Google Authenticator)에 아래 비밀 글자나 주소를 넣으세요. 화면을 찍거나 어디에 적어 두지 마세요.",
      );
      io.print(`  비밀 글자: ${enrollment.secret}`);
      io.print(`  주소: ${enrollment.uri}`);
      const code = await askCode(io, "인증 앱이 보여 주는 6자리 번호: ");
      const upgraded = await auth.verifyTotp(token, enrollment.factorId, code);
      if (upgraded === null) {
        await auth.unenroll(token, enrollment.factorId);
        throw new EnrollError("번호가 맞지 않아 등록을 지웠어요. 처음부터 다시 실행해 주세요");
      }
      token = upgraded;
      totp = "new";
    }
    const row = await db.query<{ id: string; disabled: boolean }>(
      `INSERT INTO operators (email, display_name, mfa_enrolled_at) VALUES ($1, $2, $3)
       ON CONFLICT ((lower(email))) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             mfa_enrolled_at = CASE WHEN $4 THEN EXCLUDED.mfa_enrolled_at
                                    ELSE COALESCE(operators.mfa_enrolled_at, EXCLUDED.mfa_enrolled_at) END
       RETURNING id, disabled_at IS NOT NULL AS disabled`,
      [args.email, args.displayName, deps.now(), totp === "new"],
    );
    const saved = row.rows[0] as { id: string; disabled: boolean };
    io.print(`운영자 표에 맞췄어요(운영자 ID ${saved.id}).`);
    if (saved.disabled) io.print("이 운영자는 막혀 있어요(disabled_at). 이 도구는 풀지 않아요.");
    return { operatorId: saved.id, totp, disabled: saved.disabled };
  } finally {
    await auth.signOut(token);
  }
}
