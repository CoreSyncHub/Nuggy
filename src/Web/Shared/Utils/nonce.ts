export default function nonce(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
