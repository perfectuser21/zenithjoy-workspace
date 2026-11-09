// Approved 101 test closure only; 102 audio exploration and Source packaging stay separate.
export const PHONE_DARWIN_SUITES=Object.freeze([
 'native-phone-adb-read.test.mjs','native-phone-clip-state.test.mjs','native-phone-command-source.test.mjs',
 'native-phone-foreground.test.mjs','native-phone-integration.test.mjs','native-phone-link-macros.test.mjs',
 'native-phone-link-resolver.test.mjs','native-phone-local-producer.test.mjs','native-phone-preflight-adapter.test.mjs',
 'native-phone-public-executor.test.mjs','native-phone-queue.test.mjs','native-phone-queue-idle-error.test.mjs','native-phone-screenshot-wire.test.mjs',
 'native-phone-search-macros.test.mjs','native-phone-source-issuer.test.mjs','native-phone-ui.test.mjs',
 'native-phone-vision.test.mjs','runner-phone-commander.test.mjs',
]);
export const isPhoneDarwinTest=path=>PHONE_DARWIN_SUITES.includes(path.split('/').at(-1));
