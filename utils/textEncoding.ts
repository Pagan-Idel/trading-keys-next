const MOJIBAKE_MARKERS = /(?:Ã.|Â.|â.|ðŸ|ï¸)/;

const WINDOWS_1252_BYTES: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

const decodeMojibakePass = (input: string): string => {
  const bytes: number[] = [];
  for (const character of input) {
    const mapped = WINDOWS_1252_BYTES[character];
    const codePoint = character.codePointAt(0)!;
    if (mapped !== undefined) bytes.push(mapped);
    else if (codePoint <= 0xff) bytes.push(codePoint);
    else return input;
  }
  return Buffer.from(bytes).toString('utf8');
};

export const fixMojibake = (input: string): string => {
  let output = input;
  for (let pass = 0; pass < 2 && MOJIBAKE_MARKERS.test(output); pass += 1) {
    const repaired = decodeMojibakePass(output);
    if (repaired.includes('�') || repaired === output) break;
    output = repaired;
  }
  return output;
};

