/**
 * List of email domains that are considered trusted testers for Shuncode.
 */
const SHUNCODE_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

/**
 * Checks if the given email belongs to a Shuncode internal user.
 */
export function isShuncodeBotUser(email: string): boolean {
	return SHUNCODE_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}

export function isShuncodeInternalTester(email: string): boolean {
	return isShuncodeBotUser(email) || SHUNCODE_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
