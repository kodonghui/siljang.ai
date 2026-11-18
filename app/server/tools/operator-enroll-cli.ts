/**
 * 운영자 등록 명령(TASK-021): `npm run operator:enroll -w server -- --email <이메일> --name <화면에 보일 이름>`.
 * 본체는 operator-enroll.ts, 차례와 남기지 않는 것은 그 머리말과 app/README.md(TASK-021)에 있다.
 * - 환경 변수: DATABASE_URL(그 환경의 데이터베이스), SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. 값의 검사는 서버 설정 모듈
 *   (readSettings)을 그대로 쓰고, 값은 화면에 내지 않는다.
 * - 터미널(TTY)에서만 돈다. 비밀번호를 파이프·파일로 받지 않는다.
 * - 종료 코드: 0 끝남, 2 시작하지 않음(옵션·설정·터미널 아님), 1 등록하지 못함.
 */
import { createInterface } from "node:readline/promises";
import { pgConnector } from "../src/db";
import { AuthUnavailableError, supabaseAuth } from "../src/operator-auth";
import { readSettings, SettingsError } from "../src/settings";
import { EnrollError, type EnrollIo, enrollOperator, parseArgs } from "./operator-enroll";

function usage(): string {
  return [
    "사용: npm run operator:enroll -w server -- --email <이메일> --name <화면에 보일 이름>",
    "환경 변수: DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY",
  ].join("\n");
}

/** 터미널 입력. 숨긴 입력은 raw 모드로 한 글자씩 받고 아무것도 다시 쓰지 않는다. */
function terminalIo(): EnrollIo {
  return {
    async ask(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    askHidden(question) {
      return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        process.stdout.write(question);
        let value = "";
        const done = () => {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
        };
        const onData = (chunk: Buffer | string) => {
          for (const ch of String(chunk)) {
            if (ch === "\r" || ch === "\n") {
              done();
              resolve(value);
              return;
            }
            if (ch === "\u0003") {
              done();
              reject(new EnrollError("멈췄어요"));
              return;
            }
            if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
            else value += ch;
          }
        };
        stdin.setRawMode(true);
        stdin.setEncoding("utf8");
        stdin.on("data", onData);
        stdin.resume();
      });
    },
    print(line) {
      process.stdout.write(`${line}\n`);
    },
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("터미널에서 실행해 주세요(비밀번호를 파이프·파일로 받지 않아요)\n");
    return 2;
  }
  let settings: ReturnType<typeof readSettings>;
  try {
    settings = readSettings(process.env);
  } catch (e) {
    process.stderr.write(`${e instanceof SettingsError ? e.message : "설정을 읽지 못했어요"}\n`);
    return 2;
  }
  const url = settings.secrets.DATABASE_URL;
  if (url === null || settings.operatorAuth === null) {
    process.stderr.write("DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY가 모두 있어야 해요\n");
    return 2;
  }
  const db = pgConnector(url);
  try {
    const result = await enrollOperator(
      { auth: supabaseAuth(settings.operatorAuth), db, now: () => new Date(), io: terminalIo() },
      args,
    );
    process.stdout.write(`끝남: 2단계 인증 ${result.totp === "new" ? "새로 등록" : "이미 있음"}\n`);
    return 0;
  } catch (e) {
    if (e instanceof EnrollError) process.stderr.write(`${e.message}\n`);
    else if (e instanceof AuthUnavailableError) process.stderr.write(`Supabase가 답하지 않아요(${e.reason})\n`);
    else process.stderr.write(`등록하지 못했어요(${e instanceof Error ? e.name : "Error"})\n`);
    return 1;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
