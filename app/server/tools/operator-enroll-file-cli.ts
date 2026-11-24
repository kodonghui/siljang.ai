/** 합성 계정의 새 값은 인자/출력으로 받지 않는다. .dev.vars는 시험 후 사용자가 삭제한다. */
import { runFileEnrollment } from "./operator-enroll-file";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--private-file" || args[2] !== "--exchange-dir" || !args[1] || !args[3]) {
    process.stderr.write(
      "사용: operator:enroll:synthetic --private-file <app/server/.dev.vars> --exchange-dir <새 교환 폴더>\n",
    );
    return 2;
  }
  try {
    await runFileEnrollment({ privateFile: args[1], exchangeDir: args[3] });
    process.stdout.write("새 합성 운영자 등록의 실제 결과를 확인했어요\n");
    return 0;
  } catch {
    process.stderr.write("합성 운영자 등록을 확인하지 못했어요\n");
    return 1;
  }
}
process.exitCode = await main();
