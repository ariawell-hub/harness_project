// 자체 테스트용 읽기 전용 GitHub REST 흉내(ctx.api가 자식 프로세스로 띄운다).
// 실행기는 대상 하네스의 CLI를 동기 실행하므로, 그 CLI의 조회에 답할 서버는 다른 프로세스여야 한다.
// 인자: <경로 → JSON 응답 파일> <요청 기록 파일>. 127.0.0.1의 빈 포트에서 듣고 포트 번호를 stdout 한 줄로 알린다.
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const [routesFile, logFile] = process.argv.slice(2);
/** 실행기가 끄지 못했을 때(강제 종료 등) 남지 않게 스스로 끝낸다 */
const LIFETIME_MS = 600_000;

const server = createServer((req, res) => {
  const p = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
  appendFileSync(logFile, `${req.method} ${p}\n`);
  // 시나리오가 중간에 응답을 바꿀 수 있게 요청마다 다시 읽는다
  const routes = JSON.parse(readFileSync(routesFile, 'utf8')) as Record<string, unknown>;
  const found = req.method === 'GET' && Object.hasOwn(routes, p);
  res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(found ? routes[p] : { message: 'Not Found' }));
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${(server.address() as AddressInfo).port}\n`);
});
setTimeout(() => process.exit(0), LIFETIME_MS);
