/** The request header a browser test sets to make the root layout throw (B2-T155). */
export const ROOT_ERROR_CHECK_HEADER = "x-root-error-check";

/**
 * Test only: should the root layout throw on purpose, so the global error page can be checked in
 * a browser? Only where the /design gallery is enabled (development, or a preview build with
 * `DESIGN_GALLERY=1`); the live Worker never sets that, so production always answers false and
 * never even reads the request headers (`getHeaders` is not called, which also keeps every page
 * from becoming dynamic there).
 */
export async function shouldThrowRootError(
  galleryEnabled: boolean,
  getHeaders: () => Promise<Pick<Headers, "get">>,
): Promise<boolean> {
  if (!galleryEnabled) return false;
  try {
    return (await getHeaders()).get(ROOT_ERROR_CHECK_HEADER) === "1";
  } catch {
    // Some renders have no request to read, the not found page for an unknown path among them
    // (it answered 500 here). No headers means no trigger, never an error of its own.
    return false;
  }
}
