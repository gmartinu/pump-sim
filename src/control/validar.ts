import type { Schema } from './catalogo.js';

/**
 * Minimal validator for the JSON Schema subset the catalog uses (type, enum,
 * const, anyOf, pattern, minimum, maximum, properties, required,
 * additionalProperties, items). Returns the list of errors (empty = valid).
 */
export function validar(s: Schema, v: unknown, caminho = 'args'): string[] {
  const erros: string[] = [];
  const t = s.type as string | undefined;
  if (s.anyOf) {
    const ok = (s.anyOf as Schema[]).some((x) => validar(x, v, caminho).length === 0);
    if (!ok) erros.push(`${caminho}: não casa com nenhuma forma aceita`);
    return erros;
  }
  if ('const' in s && v !== s.const) return [`${caminho}: deve ser ${JSON.stringify(s.const)}`];
  if (s.enum && !(s.enum as unknown[]).includes(v)) return [`${caminho}: deve ser um de ${JSON.stringify(s.enum)}`];
  if (t) {
    const tipoOk =
      t === 'integer'
        ? Number.isInteger(v)
        : t === 'number'
          ? typeof v === 'number' && Number.isFinite(v)
          : t === 'object'
            ? typeof v === 'object' && v !== null && !Array.isArray(v)
            : t === 'array'
              ? Array.isArray(v)
              : t === 'null'
                ? v === null
                : typeof v === t;
    if (!tipoOk) return [`${caminho}: deve ser ${t}`];
  }
  if (typeof v === 'number') {
    if (typeof s.minimum === 'number' && v < s.minimum) erros.push(`${caminho}: mínimo ${s.minimum}`);
    if (typeof s.maximum === 'number' && v > s.maximum) erros.push(`${caminho}: máximo ${s.maximum}`);
  }
  if (typeof v === 'string' && typeof s.pattern === 'string' && !new RegExp(s.pattern).test(v)) {
    erros.push(`${caminho}: formato inválido`);
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => erros.push(...validar(s.items as Schema, x, `${caminho}[${i}]`)));
  if (t === 'object' && typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const r of (s.required ?? []) as string[]) if (o[r] === undefined) erros.push(`${caminho}.${r}: obrigatório`);
    for (const [k, x] of Object.entries(o)) {
      if (x === undefined) continue;
      const ps = props[k];
      if (ps) erros.push(...validar(ps, x, `${caminho}.${k}`));
      else if (s.additionalProperties === false) erros.push(`${caminho}.${k}: parâmetro desconhecido`);
      else if (typeof s.additionalProperties === 'object') erros.push(...validar(s.additionalProperties as Schema, x, `${caminho}.${k}`));
    }
  }
  return erros;
}
