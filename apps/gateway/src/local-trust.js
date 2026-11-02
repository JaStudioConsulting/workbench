import { isIP } from "node:net";

function normalizedAddress(value) {
  if (typeof value !== "string") return "";
  const withoutZone = value.trim().split("%")[0];
  return withoutZone.startsWith("::ffff:") ? withoutZone.slice(7) : withoutZone;
}

function ipv4Parts(value) {
  if (isIP(value) !== 4) return null;
  return value.split(".").map(Number);
}

export function isTrustedLocalAddress(value) {
  const address = normalizedAddress(value);
  const parts = ipv4Parts(address);
  if (parts) {
    const [first, second] = parts;
    return first === 127
      || first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 100 && second >= 64 && second <= 127);
  }
  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  return lower === "::1"
    || lower.startsWith("fc")
    || lower.startsWith("fd")
    || lower.startsWith("fe8")
    || lower.startsWith("fe9")
    || lower.startsWith("fea")
    || lower.startsWith("feb");
}

export function createMeetingTranscriptionAccess({ env, authenticated }) {
  if (env.LOCAL_TRUSTED_MODE !== "1") return authenticated;
  return (req, res, next) => {
    if (isTrustedLocalAddress(req.socket?.remoteAddress)) return next();
    return authenticated(req, res, next);
  };
}
