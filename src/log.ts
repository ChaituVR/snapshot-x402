export function log(scope: string, event: string, fields?: object) {
  const line = `[${scope}] ${event}`;
  if (fields) console.log(line, JSON.stringify(fields));
  else console.log(line);
}
