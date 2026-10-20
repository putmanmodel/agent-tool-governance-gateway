import { createReceiver } from './receiver.mjs';

const port = Number(process.env.RECEIVER_PORT ?? 18089);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid RECEIVER_PORT');
const fixture = createReceiver({ onRecord: record => process.stdout.write(`${JSON.stringify(record)}\n`) });
fixture.server.listen(port, '127.0.0.1', () => process.stderr.write(`Receiver listening on 127.0.0.1:${port}\n`));
process.on('SIGTERM', () => fixture.server.close());
process.on('SIGINT', () => fixture.server.close());
