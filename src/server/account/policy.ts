/**
 * How recent the sign in must be to delete an account (spec 0015 step 7, decided with Michael
 * 2026-11-14). Better Auth's `deleteUser` refuses a session older than `session.freshAge` with
 * `SESSION_EXPIRED`; its default is one day, too loose for something that cannot be undone.
 * Nothing else in the app uses session freshness.
 */
export const ACCOUNT_DELETE_FRESH_SECONDS = 10 * 60;
