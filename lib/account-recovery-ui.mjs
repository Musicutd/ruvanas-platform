const signInDestinations = new Set([
  "/login?password-reset=1",
  "/rewards/pilot-sign-in?password-reset=1"
]);

export const RECOVERY_REQUEST_ACCEPTED = "If your account is eligible, look for a private recovery email. This message does not confirm that an email was delivered.";
export const RECOVERY_RESET_COMPLETE = "Your password has been reset and all previous sessions have been signed out.";

// A reset changes credentials, never the account's roles or pilot access.
// Do not follow arbitrary URLs or treat a closed pilot as a sign-in failure.
export function recoveryResetDestination(result) {
  return result && typeof result === "object" && !Array.isArray(result) && result.ok === true &&
    signInDestinations.has(result.destination) ? result.destination : null;
}

export function recoveryRequestMessage(response, result) {
  if (response?.ok === true && result?.ok === true) return { message: RECOVERY_REQUEST_ACCEPTED, error: "" };
  const errors = {
    400: "Enter a valid email address.",
    429: "Too many recovery requests. Please wait before trying again.",
    503: "Password recovery is unavailable right now. Please contact the Super Admin."
  };
  return { message: "", error: errors[response?.status] || "Unable to request a recovery link. Please try again shortly." };
}

export function recoveryPasswordError(password, confirmation) {
  if (typeof password !== "string" || password.length < 12) return "Use at least 12 characters for your new password.";
  // Unicode-mode matching catches unpaired surrogates without requiring the
  // newer String.prototype.isWellFormed browser API. Valid emoji stay intact.
  if (password.includes("\0") || /[\uD800-\uDFFF]/u.test(password)) return "Your password contains an unsupported character. Please choose a different password.";
  if (new TextEncoder().encode(password).byteLength > 72) return "Your password is too long. Use no more than 72 plain characters, or fewer accented letters or emoji.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Include at least one letter and one number in your password.";
  if (password !== confirmation) return "The new password confirmation does not match.";
  return "";
}
