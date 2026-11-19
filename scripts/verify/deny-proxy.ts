// verify의 거부 프록시(설계서 11.1절 "열 수 있는 주소").
// 브라우저의 요청 가운데 앱 주소가 아닌 것은 모두 이 프록시로 온다(브라우저 설정은 profiles/web/verify/).
// 여기에 닿은 것은 모두 허용 밖이다: 아무것도 전달하지 않고 거부하며, 종류·호스트·포트만 기록한다.
// 허용 목록 판단은 여기에 없다(전달 기능이 있으면 그 판단의 버그가 곧 외부 접속이 된다).
import http from 'node:http';
import type { Duplex } from 'node:stream';

export interface DeniedRequest {
  kind: 'http' | 'connect' | 'upgrade';
  host: string;
  port: number;
}
export interface DenyProxy {
  /** http://127.0.0.1:<포트> */
  url: string;
  /** 지금까지 거부한 요청(최대 1000건까지 담는다) */
  denied(): DeniedRequest[];
  /** 거부한 요청의 전체 건수(1000건을 넘어도 센다) */
  count(): number;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const MAX_RECORDS = 1000;
export const UNKNOWN_HOST = '(알 수 없음)';
const UNKNOWN = { host: UNKNOWN_HOST, port: 0 };

/** 절대 URL의 앞부분(스킴과 authority)만 본다. 경로와 쿼리 문자열은 읽지 않는다 */
const ABSOLUTE = /^([A-Za-z][A-Za-z0-9+.-]{0,15}):\/\/([^/?#\\]*)/;
/** 호스트 이름·IPv4·대괄호로 싼 IPv6와 포트. 그 밖의 글자가 있으면 호스트로 보지 않는다 */
const AUTHORITY = /^(\[[0-9A-Fa-f:.]{2,45}\]|[A-Za-z0-9._-]{1,253})(?::([0-9]{1,5}))?$/;
/** 스킴의 기본 포트. 일반 객체로 두면 `constructor` 같은 스킴이 물려받은 속성을 집는다(구현 판정 F1) */
const DEFAULT_PORT = new Map<string, number>([
  ['http', 80],
  ['ws', 80],
  ['https', 443],
  ['wss', 443],
]);

/** `host[:port]`에서 호스트와 포트. 기록에 남는 글자는 여기서 걸러진 호스트 이름뿐이다 */
function target(authority: string, scheme: string | null): { host: string; port: number } {
  // 사용자 정보(user:pass@)는 버린다
  const at = authority.lastIndexOf('@');
  const m = AUTHORITY.exec(at >= 0 ? authority.slice(at + 1) : authority);
  if (!m) return UNKNOWN;
  // 포트가 없으면 스킴의 기본 포트, 모르는 스킴이면 0이다. 포트는 언제나 0~65535의 정수다
  const port = m[2] ? Number(m[2]) : ((scheme ? DEFAULT_PORT.get(scheme) : undefined) ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return UNKNOWN;
  return { host: m[1].toLowerCase(), port };
}

/** 일반 요청·업그레이드 요청의 대상: 절대 URL이면 그 authority, 아니면 Host */
function requestTarget(req: http.IncomingMessage): { host: string; port: number } {
  const abs = ABSOLUTE.exec(typeof req.url === 'string' ? req.url : '');
  if (abs) return target(abs[2], abs[1].toLowerCase());
  const host = req.headers.host;
  return typeof host === 'string' ? target(host, 'http') : UNKNOWN;
}

const FORBIDDEN = 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

/** 127.0.0.1의 빈 포트에서 거부 프록시를 띄운다 */
export function startDenyProxy(): Promise<DenyProxy> {
  const records: DeniedRequest[] = [];
  let total = 0;
  const record = (kind: DeniedRequest['kind'], t: { host: string; port: number }) => {
    total++;
    if (records.length < MAX_RECORDS) records.push({ kind, host: t.host, port: t.port });
  };
  const sockets = new Set<Duplex>();
  // Host가 없는 요청도 우리가 받아서 센다(기본값은 Node가 400으로 답하고 알리지 않는다)
  const server = http.createServer({ requireHostHeader: false });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 1;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  server.on('request', (req, res) => {
    record('http', requestTarget(req));
    res.on('error', () => {});
    res.writeHead(403, { Connection: 'close', 'Content-Length': '0' });
    res.end(() => req.socket.destroySoon());
  });
  server.on('connect', (req, socket: Duplex) => {
    record('connect', target(typeof req.url === 'string' ? req.url : '', null));
    socket.on('error', () => {});
    socket.end(FORBIDDEN, () => socket.destroy());
  });
  server.on('upgrade', (req, socket: Duplex) => {
    record('upgrade', requestTarget(req));
    socket.on('error', () => {});
    socket.destroy();
  });
  server.on(
    'clientError',
    (err: NodeJS.ErrnoException, socket: Duplex & { bytesRead?: number }) => {
      // 읽을 수 없는 요청도 프록시에 닿은 것이다. 아무것도 보내지 않고 끊긴 연결과 시간 초과는 요청이 아니다
      const parseError = typeof err.code === 'string' && err.code.startsWith('HPE_');
      if (parseError && (socket.bytesRead ?? 0) > 0) record('http', UNKNOWN);
      socket.destroy();
    },
  );

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // 다른 인터페이스에 바인드하지 않는다
    server.listen(0, HOST, () => {
      server.off('error', reject);
      server.on('error', () => {});
      const addr = server.address();
      if (!addr || typeof addr !== 'object') {
        server.close();
        reject(new Error('거부 프록시의 포트를 받지 못했다'));
        return;
      }
      let closing: Promise<void> | null = null;
      resolve({
        url: `http://${HOST}:${addr.port}`,
        denied: () => records.map((r) => ({ ...r })),
        count: () => total,
        close: () =>
          (closing ??= new Promise<void>((done) => {
            server.close(() => done());
            for (const s of sockets) s.destroy();
          })),
      });
    });
  });
}
