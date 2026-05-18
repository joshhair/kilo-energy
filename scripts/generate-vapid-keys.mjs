// Generate a VAPID keypair for Web Push.
//
// Run once per environment, then add the output to .env (server) and
// configure NEXT_PUBLIC_VAPID_PUBLIC_KEY (client) with the same public
// half. Existing PushSubscriptions are bound to the public key — rotating
// it invalidates every device, which is why we only run this when
// bootstrapping or on a known compromise.
//
// Usage: node scripts/generate-vapid-keys.mjs

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('--- Copy these into .env (server) ---');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:support@kiloenergies.com`);
console.log('');
console.log('--- Copy this into .env.local (client, NEXT_PUBLIC_ prefix) ---');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log('');
console.log('Rotating these invalidates every existing PushSubscription.');
