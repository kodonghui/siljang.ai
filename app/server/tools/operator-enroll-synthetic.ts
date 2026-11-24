/** 새 합성 계정 전용. 기존 사용자의 인증 수단/비밀을 읽거나 바꾸지 않는다. */
import type { Queryable } from "../src/db";
import type { OperatorAuth } from "../src/operator-auth";
import { checkArgs, type EnrollResult, enrollOperator } from "./operator-enroll";
import { EnrollmentBridgeError, totpCode } from "./operator-enroll-bridge";

export class SyntheticEnrollmentError extends Error {
  override readonly name = "SyntheticEnrollmentError";
  constructor() {
    super("합성 운영자 등록을 확인하지 못했어요");
  }
}
export interface SyntheticEnrollmentOptions {
  readonly auth: OperatorAuth;
  readonly db: Queryable;
  readonly target: { email: string; authUserId: string; displayName: string };
  readonly password: string;
  readonly resume?: { factorId: string; secret: string };
  readonly now: () => Date;
  readonly saveNewTotp: (value: { factorId: string; secret: string }) => Promise<void>;
}
export async function enrollSyntheticOperator(options: SyntheticEnrollmentOptions): Promise<EnrollResult> {
  const { auth, target } = options;
  let factorId: string | null = options.resume?.factorId ?? null,
    secret: string | null = options.resume?.secret ?? null;
  try {
    const args = checkArgs(target);
    if (
      args.email !== target.email ||
      !/^mvp-operator-[0-9]{8}(?:-[a-z0-9]{4,16})?@example\.com$/.test(args.email) ||
      !args.displayName.startsWith("합성") ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(target.authUserId) ||
      options.password.length < 16
    )
      throw new EnrollmentBridgeError();
    const protectedAuth: OperatorAuth = {
      signInWithPassword: (email, password) => auth.signInWithPassword(email, password),
      getUser: async (token) => {
        const user = await auth.getUser(token);
        if (!user || user.id !== target.authUserId || user.email !== target.email || user.factors === null)
          throw new EnrollmentBridgeError();
        if (options.resume === undefined) {
          if (user.factors.length !== 0) throw new EnrollmentBridgeError();
        } else {
          totpCode(options.resume.secret, options.now().getTime());
          const existing = user.factors[0];
          if (
            user.factors.length !== 1 ||
            existing?.id !== options.resume.factorId ||
            existing.type !== "totp" ||
            existing.status !== "verified"
          )
            throw new EnrollmentBridgeError();
        }
        return user;
      },
      enrollTotp: async (token, name) => {
        if (options.resume !== undefined) throw new EnrollmentBridgeError();
        const value = await auth.enrollTotp(token, name);
        if (value === null) return null;
        factorId = value.factorId;
        try {
          totpCode(value.secret, options.now().getTime());
          await options.saveNewTotp({ factorId: value.factorId, secret: value.secret });
          secret = value.secret;
        } catch {
          await auth.unenroll(token, value.factorId);
          throw new EnrollmentBridgeError();
        }
        return value;
      },
      verifyTotp: (token, factor, code) => {
        if (factorId === null || factor !== factorId || secret === null) throw new EnrollmentBridgeError();
        return auth.verifyTotp(token, factor, code);
      },
      unenroll: (token, factor) => {
        if (options.resume !== undefined) throw new EnrollmentBridgeError();
        if (factorId === null || factor !== factorId) throw new EnrollmentBridgeError();
        return auth.unenroll(token, factor);
      },
      signOut: (token) => auth.signOut(token),
    };
    return await enrollOperator(
      {
        auth: protectedAuth,
        db: options.db,
        now: options.now,
        io: {
          askHidden: async () => options.password,
          ask: async () => {
            if (secret === null) throw new EnrollmentBridgeError();
            return totpCode(secret, options.now().getTime());
          },
          print: () => {},
        },
      },
      args,
    );
  } catch {
    throw new SyntheticEnrollmentError();
  }
}
