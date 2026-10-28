import { parentPort, workerData } from 'node:worker_threads';
import { createDistServer } from './serve.mjs';

const server = createDistServer(workerData.dist);
server.listen(0, () => parentPort.postMessage({ port: server.address().port }));
