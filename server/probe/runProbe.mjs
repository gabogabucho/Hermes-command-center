import { collectHermesFleetSnapshot } from './fleetProbe.mjs';

const payload = await collectHermesFleetSnapshot();
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
