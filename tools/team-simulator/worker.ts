import { compare } from './simulator';
self.onmessage = ({ data }) => {
  try { self.postMessage({ type: 'result', result: compare(data.roster, data.config, (done, total) => self.postMessage({ type: 'progress', done, total })) }); }
  catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : '시뮬레이션에 실패했습니다.' }); }
};
