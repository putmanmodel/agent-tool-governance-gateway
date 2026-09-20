// Exercise real producers for schema validation; no runtime imports this fixture.
import { KingpinAuthority } from '../../gateway_node/kingpin/authority.js';
const signals = JSON.parse(process.argv[2]);
const authority = new KingpinAuthority({ clock: () => 1700000000000 });
const request = { tool: 'fs.list', args: { path: '/project' }, speaker_id: 'actor', channel_id: 'channel', scene_id: 'scene' };
const decisions = signals.map((signal, i) => authority.decide(signal, request, `fixture-${i}`));
const lease = authority.issue({ ...request, seconds: 60 });
console.log(JSON.stringify({ request, decisions, lease }));
