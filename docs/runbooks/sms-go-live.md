# SMS go-live (Phase D unblock)

What to do the moment Twilio approves the A2P 10DLC registration. Code
is fully wired and tested — this runbook flips the production switch.

## Prereqs (must be true before starting)

- [ ] A2P 10DLC Brand + Campaign status = **Approved** in Twilio console
      (Messaging → A2P 10DLC). Until both are green, sends from a long
      code will get filtered or charged the unregistered surcharge.
- [ ] Verify Service exists (Twilio console → Verify → Services). Note
      its SID — starts with `VA…`.
- [ ] A Twilio phone number is bought, associated with the approved
      campaign, and SMS-capable. Note the E.164 number.

## Env vars to set in Vercel (Production)

Project → Settings → Environment Variables. All four must be set
before flipping `SMS_ENABLED`:

| Name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | `AC…` from Twilio console (Dashboard) |
| `TWILIO_AUTH_TOKEN` | the matching auth token (rotate-able) |
| `TWILIO_FROM` | the E.164 number that owns the campaign |
| `TWILIO_VERIFY_SERVICE_SID` | the `VA…` Verify Service SID |
| `SMS_ENABLED` | `true` (literal lowercase string) |

Apply to **Production** environment only at first. Preview/Development
deploys stay stubbed — there is no test phone number to leak SMS into.

## Trigger a redeploy

The env vars only take effect on next deploy. Two paths:

1. Re-run the most recent deploy from the Vercel dashboard, OR
2. Push an empty commit: `git commit --allow-empty -m "chore: pick up SMS_ENABLED"`

Wait for the deploy to go live.

## Smoke test

1. Open Settings → Notifications → expand "Phone & quiet hours".
2. The SMS column on each event row should now show as active (no
   longer "Coming soon").
3. Enter your own phone in E.164 (e.g. `+14155551234`). Click **Send code**.
4. SMS arrives within ~10s. Enter the code. Click **Verify**.
5. UI should flip to **Verified**.

If the code never arrives:
- Check Vercel function logs for `start-verify` → look for
  `errorReason: TWILIO_<code>: …`.
- Common codes:
  - `60200` — invalid phone format (must be E.164 with `+`).
  - `60203` — max send attempts reached. Wait 10 min.
  - `60410` — Verify Service rate-limit. Check Twilio console.
  - `30003` / `30005` — unreachable handset (carrier issue).

## End-to-end test

Once a verified phone is on file, fire any non-mandatory event that
defaults SMS=on for the user. (No event defaults SMS=on today —
defaults all ship `sms: false` per `lib/notifications/events.ts`. To
smoke-test you'll need to flip one toggle on yourself.)

The fastest path:
1. In Settings → Notifications, expand Mentions → enable SMS for
   "You were @-mentioned".
2. Have a teammate `@you` in a project chatter message.
3. SMS + email should both land.
4. Check `NotificationDelivery` table — there should be a row with
   `channel='sms'`, `status='sent'`, `providerMessageId='SM…'`.

## Quiet hours sanity check

Set Quiet hours to a window that includes the current UTC hour (e.g.
if it's 21:00 UTC, set 20→22). Fire the mention test again. Expect:
- SMS delivery row: `status='failed'`, `reason='quiet hours'`
- Email delivery row: `status='sent'` (email always passes quiet hours)
- A mandatory event (e.g. trigger a `pay_chargeback` test) bypasses
  quiet hours and SMS lands.

## Rolling back

If something goes wrong, the fastest kill switch is:

```
vercel env rm SMS_ENABLED production
# then redeploy
```

The adapter returns `NOT_CONFIGURED` the moment `SMS_ENABLED !== 'true'`,
no other env vars or migrations need to change. Phone rows in the DB
stay valid — when you re-enable, users don't need to re-verify.

## Announcement copy (for #general / launch email)

> SMS notifications are now live in Kilo. Head to Settings →
> Notifications, expand "Phone & quiet hours", verify your phone,
> then toggle SMS on for any event you want a text on. Per-event
> opt-in — nothing turns on by default.

## Related code

- `lib/notifications/channels/sms.ts` — Twilio Messages adapter.
- `lib/notifications/twilio-verify.ts` — Verify Service wrapper.
- `app/api/notifications/phone/start-verify/route.ts` + `confirm-verify/route.ts`.
- `lib/notifications/service.ts` — dispatcher + quiet-hours window
  (`isInQuietHours` is exported and unit-tested).
- `app/dashboard/settings/sections/NotificationsSection.tsx` —
  `PhoneEditor` component renders the live UI when `smsLive` is true.
