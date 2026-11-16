import { parseUsageEnv, parseWebEnv } from "@/lib/env";
import { err, ok } from "@/lib/result";
import { getAuth, getDb } from "../request";
import { type GuestEmailDeps, sendFailureOf } from "./email";

/** The real dependencies of `POST /api/guest/email` (spec 0023). */
export function guestEmailDeps(): GuestEmailDeps {
  return {
    appOrigin: new URL(parseWebEnv().BETTER_AUTH_URL).origin,
    getDb,
    hashSecret: () => parseUsageEnv().USAGE_HASH_SECRET,
    sendLink: async ({ email, callbackURL, headers }) => {
      try {
        await (
          await getAuth()
        ).api.signInMagicLink({
          body: {
            email,
            callbackURL,
            newUserCallbackURL: callbackURL,
            errorCallbackURL: "/sign-in/link-expired",
          },
          headers,
        });
        return ok(true as const);
      } catch (error) {
        return err(sendFailureOf(error));
      }
    },
  };
}
