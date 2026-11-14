/** Delete account (spec 0015 step 7): the words and the small pure rules the dialog and the sign in page share. */

/** The query value that reopens the dialog after a fresh sign in. */
export const DELETE_ACCOUNT_PARAM = "delete-account";
/** Where a fresh sign in lands so the dialog opens again. */
export const DELETE_ACCOUNT_RETURN = `/library?${DELETE_ACCOUNT_PARAM}=1`;
/** The sign in page's reason for a stale session. */
export const DELETE_ACCOUNT_REASON = "delete-account";

export const DELETE_ACCOUNT_WARNING =
  "This permanently deletes your account, every take, and every file and record for them. It cannot be undone.";
export const DELETE_ACCOUNT_STALE_NOTICE = "For safety, sign in again to delete your account.";
export const DELETE_ACCOUNT_FAILED =
  "We couldn't delete your account. Check your connection and try again.";

/** Better Auth answers `SESSION_EXPIRED` when the sign in is older than `freshAge`. */
export function isStaleSession(error: { readonly code?: string | undefined } | null): boolean {
  return error?.code === "SESSION_EXPIRED";
}
