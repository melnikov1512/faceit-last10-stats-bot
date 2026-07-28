---
applyTo: "src/services/storageService.js"
---

# Firestore Storage Service — Conventions & Best Practices

`storageService.js` is the only module allowed to talk to Firestore directly. Follow these rules when adding or modifying persistence logic.

## Deduplication Must Be Atomic

- Any "has this notification already been sent?" check **must** use Firestore's atomic `create()`, never `set()`.
- `create()` throws with code `6` (`ALREADY_EXISTS`) if the document already exists — catch that specific error and treat it as "already sent, skip silently". Any other error must propagate.
- This is the only race-condition-safe pattern for deduplication across parallel Cloud Function instances handling the same webhook event. Do **not** replace it with a read-then-write ("check if exists, then set") pattern — that reintroduces the race condition.

```js
// ✅ CORRECT
try {
    await docRef.create(data);
    return true; // newly created — proceed with sending
} catch (err) {
    if (err.code === 6) return false; // ALREADY_EXISTS — skip silently
    throw err;
}
```

## TTL Fields

- Any new document type intended for automatic cleanup must include an `expireAt` field (Firestore native TTL policy is configured on this field name — do not invent a new field name per collection).
- Set `expireAt = sentAt + 7 days` unless a different retention period is explicitly required — match the existing `sent_match_notifications` convention.
- Remember: enabling TTL on a **new** collection requires running `gcloud firestore fields ttls update expireAt --collection-group=<name> --enable-ttl --project=<GCLOUD_PROJECT>` once — TTL is not automatic just by adding the field.

## Document ID Conventions

Keep composite IDs predictable and greppable — follow the existing patterns when adding new collections:
- Per-chat state: `{chatId}`
- Per-chat-and-match state: `{chatId}_{matchId}`
- Dedup / notification-type variants: `{matchId}_{chatId}_{suffix}` (e.g. `_finish`)

Do not introduce auto-generated Firestore doc IDs for anything that needs idempotent writes or cross-instance lookups — a predictable composite ID is what makes `create()`-based dedup work.

## Cross-Chat / Cross-Player Queries

- When a lookup needs to work across chats (e.g. finding an active match for a player regardless of which chat added them), store the relevant player ID(s) in an **array field** (e.g. `playerIds[]`) on the notification/state document, and query with `array-contains`. This is what powers `getRecentMatchIdsForPlayers`.
- Prefer a bounded time window (the existing convention is 6 hours) over an unbounded query when searching by array-contains — Firestore composite queries on array fields do not have great index characteristics for large unbounded scans.

## Firestore Mode

- This project requires Firestore in **Native Mode**. Never write code that assumes Datastore Mode semantics (e.g. ancestor queries, key structure).

## General

- All Firestore reads/writes for a given concern live in this file — don't reach into `firestore` directly from handlers or other services; add a new exported function here instead.
- Keep collection/field names in this file as the single source of truth; if you add or rename a collection or field, update the **Storage Module** section of `AGENTS.md` in the same change.
