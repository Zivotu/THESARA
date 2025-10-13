## @loopyway/sdk – Rooms API client

This package exposes utilities injected into hosted apps (`window.loopyway`)
and, starting with Rooms V1, a small fetch-based client you can import in
custom code.

### RoomsClient

```ts
import { RoomsClient } from '@loopyway/sdk/rooms';

const rooms = new RoomsClient({ baseUrl: 'https://api.thesara.space/api' });

const { token, room } = await rooms.createRoom({
  roomCode: 'family',
  pin: '1234',
  name: 'Ana',
});

const state = await rooms.getRoomState({ roomCode: room.roomCode, token });

await rooms.addItem({
  roomCode: room.roomCode,
  token,
  expectedVersion: state.room.version,
  body: { icon: '🍎', name: 'Jabuke', qty: '2kg', estPriceCents: 480 },
});
```

All mutating calls (`addItem`, `updateItem`, `removeItem`, `finalizePurchase`,
`rotatePin`) require the current `room.version` in the `expectedVersion`
field. The client automatically sends the appropriate `If-Match` and
`x-idempotency-key` headers and returns the updated room summary along with
the affected item/purchase.

### Global injection (`window.loopyway`)

If you rely on the auto-injected script from the publish pipeline,
`window.loopyway.rooms` remains available for backwards compatibility. For new
apps we recommend importing the typed client directly as shown above.
