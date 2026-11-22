// Skills taxonomy for the Skills map (docs/SKILLS_MAP.md).
//
// A deliberately small subset of public frameworks. Names and identifiers are copied from the official sources
// listed in FRAMEWORKS. Levels are "aligned with" or "related to" these entries; nothing here is a certification,
// an exam syllabus or an endorsement by the framework owners. Add an entry only when you are certain of the name
// and the identifier: a missing skill is better than a wrong one.

export const FRAMEWORKS = [
  {
    id: 'owasp',
    name: 'OWASP Top 10 (2021)',
    short: 'OWASP Top 10',
    owner: 'OWASP Foundation',
    // Official source: https://owasp.org/Top10/
    url: 'https://owasp.org/Top10/',
    note: 'The ten most critical web application risk categories, 2021 edition. A newer edition may exist; this map pins 2021.',
  },
  {
    id: 'attack',
    name: 'MITRE ATT&CK (Enterprise)',
    short: 'MITRE ATT&CK',
    owner: 'The MITRE Corporation',
    // Official source: https://attack.mitre.org/
    url: 'https://attack.mitre.org/',
    note: 'Adversary techniques. Levels relate to techniques as examples of what to recognise, investigate or decode, not as attack training.',
  },
  {
    id: 'nice',
    name: 'NICE Framework work role categories',
    short: 'NICE Framework',
    owner: 'NIST',
    // Official source: NIST SP 800-181 Revision 1 (2020), https://csrc.nist.gov/pubs/sp/800/181/r1/final
    url: 'https://csrc.nist.gov/pubs/sp/800/181/r1/final',
    note: 'The seven category names of NIST SP 800-181 Rev. 1. Category level only: no work roles, tasks, knowledge or skill statements. NICE has been revised since; this map pins Rev. 1.',
  },
  {
    id: 'area',
    name: 'CTF skill areas',
    short: 'CTF skill areas',
    owner: 'CTF Arena',
    // Not an external standard: the plain categories used by most CTF events (see docs/CTF_DESIGN_RESEARCH.md).
    url: null,
    note: 'Plain skill areas used by most capture-the-flag events. These are our own labels, not a standard.',
  },
];

const owasp = (code, name) => ({ id: `owasp-${code.toLowerCase()}`, framework: 'owasp', code: `${code}:2021`, name });
const attack = (code, name) => ({
  id: `attack-${code.toLowerCase().replace('.', '-')}`,
  framework: 'attack',
  code,
  name,
  // Official technique page, e.g. https://attack.mitre.org/techniques/T1078/ or .../T1027/003/
  url: `https://attack.mitre.org/techniques/${code.replace('.', '/')}/`,
});
const nice = (code, name) => ({ id: `nice-${code.toLowerCase()}`, framework: 'nice', code, name });
const area = (key, name) => ({ id: `area-${key}`, framework: 'area', code: null, name });

export const SKILLS = [
  // OWASP Top 10 2021, https://owasp.org/Top10/ (all ten, so that gaps are visible)
  owasp('A01', 'Broken Access Control'),
  owasp('A02', 'Cryptographic Failures'),
  owasp('A03', 'Injection'),
  owasp('A04', 'Insecure Design'),
  owasp('A05', 'Security Misconfiguration'),
  owasp('A06', 'Vulnerable and Outdated Components'),
  owasp('A07', 'Identification and Authentication Failures'),
  owasp('A08', 'Software and Data Integrity Failures'),
  owasp('A09', 'Security Logging and Monitoring Failures'),
  owasp('A10', 'Server-Side Request Forgery (SSRF)'),

  // MITRE ATT&CK Enterprise, https://attack.mitre.org/ (only techniques that a level honestly relates to)
  attack('T1078', 'Valid Accounts'),
  attack('T1110', 'Brute Force'),
  attack('T1110.002', 'Brute Force: Password Cracking'),
  attack('T1071', 'Application Layer Protocol'),
  attack('T1048', 'Exfiltration Over Alternative Protocol'),
  attack('T1027', 'Obfuscated Files or Information'),
  attack('T1027.002', 'Obfuscated Files or Information: Software Packing'),
  attack('T1027.003', 'Obfuscated Files or Information: Steganography'),
  attack('T1140', 'Deobfuscate/Decode Files or Information'),
  attack('T1070.004', 'Indicator Removal: File Deletion'),
  attack('T1136', 'Create Account'),
  attack('T1083', 'File and Directory Discovery'),
  attack('T1548.003', 'Abuse Elevation Control Mechanism: Sudo and Sudo Caching'),
  attack('T1622', 'Debugger Evasion'),
  attack('T1589', 'Gather Victim Identity Information'),
  attack('T1590', 'Gather Victim Network Information'),
  attack('T1593', 'Search Open Websites/Domains'),
  attack('T1594', 'Search Victim-Owned Websites'),
  attack('T1596', 'Search Open Technical Databases'),

  // NICE Framework categories, NIST SP 800-181 Rev. 1 (2020), category identifiers as published there
  nice('SP', 'Securely Provision'),
  nice('OM', 'Operate and Maintain'),
  nice('OV', 'Oversee and Govern'),
  nice('PR', 'Protect and Defend'),
  nice('AN', 'Analyze'),
  nice('CO', 'Collect and Operate'),
  nice('IN', 'Investigate'),

  // Plain CTF skill areas
  area('crypto', 'Cryptography'),
  area('reverse', 'Reverse engineering'),
  area('forensics', 'Digital forensics'),
  area('web', 'Web exploitation'),
  area('osint', 'OSINT'),
  area('linux', 'Linux and shell'),
  area('network', 'Networking'),
];

export const SKILL_BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));
export const FRAMEWORK_BY_ID = new Map(FRAMEWORKS.map((framework) => [framework.id, framework]));

/** Display label such as "A03:2021 Injection" or "T1078 Valid Accounts"; areas have no code. */
export const skillLabel = (skill) => (skill.code ? `${skill.code} ${skill.name}` : skill.name);
