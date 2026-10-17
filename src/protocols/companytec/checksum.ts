/**
 * CBC/Companytec checksum (DT435 p.3, p.36): sum of the ASCII codes of everything
 * between "(" and the KK — header (`&`/`?`) included —, 8 bits, 2-digit uppercase
 * hex. Validation is string equality: lowercase "kk" is rejected.
 */
export function checksum(corpo: string): string {
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) soma = (soma + corpo.charCodeAt(i)) & 0xff;
  return soma.toString(16).toUpperCase().padStart(2, '0');
}

/** `(` + body + KK + `)` */
export function comKK(corpo: string): string {
  return `(${corpo}${checksum(corpo)})`;
}

/** `(` + body + `)` (replies without KK: &S, &V, acks, errors, (0)). */
export function semKK(corpo: string): string {
  return `(${corpo})`;
}

/** `cmd` is the whole frame, with parentheses. Checks the KK in the 2 chars before the `)`. */
export function kkValido(cmd: string): boolean {
  if (cmd.length < 5 || cmd[0] !== '(' || cmd[cmd.length - 1] !== ')') return false;
  const interno = cmd.slice(1, -1);
  const corpo = interno.slice(0, -2);
  const kk = interno.slice(-2);
  return checksum(corpo) === kk;
}
