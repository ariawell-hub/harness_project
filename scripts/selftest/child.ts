// 하네스 자체 테스트의 자식 프로세스 진입점(설계서 12.4절). 실행기(run.ts)가 나란히 돌릴 때 시나리오 하나마다 띄운다.
// 인자: <대상 하네스> <시나리오 파일> <결과 파일>. 시나리오를 돌려 결과(id, covers, state, detail)를 결과 파일에 JSON으로 쓴다.
// 실행기 쪽 파일이라 CI의 selftest job에서는 main의 것이 돈다. 대상 하네스의 내부 모듈은 import하지 않는다.
import { writeFileSync } from 'node:fs';
import { runScenario } from './run.ts';

const [harness, file, out] = process.argv.slice(2);
if (!harness || !file || !out) {
  process.stderr.write('사용법: child.ts <대상 하네스> <시나리오 파일> <결과 파일>\n');
  process.exit(2);
}
const r = await runScenario(harness, file);
writeFileSync(out, JSON.stringify(r));
// 시나리오가 남긴 핸들(타이머 등)이 있어도 결과를 쓴 뒤에는 끝낸다
process.exit(0);
