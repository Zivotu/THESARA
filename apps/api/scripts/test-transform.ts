import { transformHtmlLite } from '../src/lib/csp.ts';

(async () => {
  const opts = {
    indexPath: 'storage/bundles/builds/d2a61ae1-857a-493e-b347-81cbc014d5d2/bundle/index.html',
    rootDir: 'storage/bundles/builds/d2a61ae1-857a-493e-b347-81cbc014d5d2/bundle',
    bundleModuleScripts: true,
    vendorExternalResources: true,
    vendorMaxBytes: 20971520,
    vendorTimeoutMs: 15000,
    failOnInlineHandlers: false,
    autoBridgeRooms: true,
    roomsStorageKeys: ['shopping/rooms/v1','shopping/session/v1'],
    log: console.log,
  } as const;
  console.log('opts', opts);
  const result = await transformHtmlLite(opts);
  console.log('result:', result);
})();
