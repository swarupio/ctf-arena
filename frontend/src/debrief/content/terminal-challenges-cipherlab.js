// Debrief content for Arena Terminal, Cipher Lab and Challenges (shown after a team captured the flag).
// Keys are category:track:level, exactly as in src/skills/levelSkills.js. Generic technique notes only: puzzles are
// generated per team, so nothing here may contain a flag or any per-team value. Plain text, no markup.

export default {
  // ---------------------------------------------------------------- Arena Terminal, easy
  'terminal:easy:1': {
    what: 'Find a welcome file buried a few folders deep in a simulated home directory using only shell navigation.',
    how: 'A shell treats everything as a tree of directories. ls lists what is in a folder, cd moves you into one, pwd tells you where you are, and cat prints a file. Nothing is hidden here: you simply have to walk the tree and look at every level before you move on. That habit of orienting yourself first is the base of every later investigation.',
    defend: 'Treat any home directory as readable by its owner and anyone with access to the box. Keep onboarding material free of credentials, store secrets in a managed vault, and set restrictive default permissions so a new account cannot browse other staff folders.',
    tools: ['ls', 'cd', 'pwd', 'cat', 'tree'],
    next: 'Try the next Arena Terminal flag and look for entries a plain listing does not show.',
  },
  'terminal:easy:2': {
    what: 'Uncover a folder that a plain directory listing does not show and read the note stored inside it.',
    how: 'On Unix systems a name that begins with a dot is a hidden file by convention only. It is not encrypted or protected: ls simply skips it unless you add the all flag. Configuration files, shell histories and private notes usually live in these dotfiles, which is why investigators always list a home folder with hidden entries included.',
    defend: 'Hiding a file behind a leading dot is not access control. Put real secrets in a secrets manager, set mode 600 or 700 on private files, and include dotfiles in your audits and in data loss prevention scans of user profiles.',
    tools: ['ls -a', 'find', 'cat', 'stat'],
    next: 'Practise filtering large files by keyword instead of reading them line by line.',
  },
  'terminal:easy:3': {
    what: 'Pull one meaningful line out of a long notes file full of noise and decoys.',
    how: 'Reading a long file by eye is slow and error prone. grep prints only the lines that match a word or pattern, so you choose a term that fits what you are hunting for and let the tool do the scanning. The file also held lookalike entries that admitted they were fake, which is a reminder to read the line you found rather than trust the first match.',
    defend: 'Defenders use the same technique on their side: central log and file search with grep or a SIEM to find secrets that leaked into notes and repositories. Run secret scanners in version control and train staff not to keep credentials in plain text notes.',
    tools: ['grep', 'grep -i', 'less', 'wc'],
    next: 'Move on to logs, where the interesting entry is usually at the end.',
  },
  'terminal:easy:4': {
    what: 'Read the newest entries of an installer log to find the current value among old and expired ones.',
    how: 'Logs are append-only, so recent events sit at the bottom. tail prints the last lines of a file without opening all of it, and head does the opposite. The log mentioned more than one value and only one was still valid, so the skill is reading the surrounding text and the order of events, not just spotting something that looks like a secret.',
    defend: 'Never write credentials, tokens or recovery codes to logs. Mask sensitive fields at the source, restrict log directories to a small group, rotate and expire logs on a schedule, and review who can read them as part of regular access reviews.',
    tools: ['tail', 'tail -f', 'head', 'less'],
    next: 'Step up to Medium and learn to search whole directory trees with find and grep.',
  },

  // ---------------------------------------------------------------- Arena Terminal, medium
  'terminal:medium:1': {
    what: 'Spot the one odd file among hundreds of near-identical exports, then decode a value that was written backwards.',
    how: 'When files look alike, metadata gives the outlier away. find can filter by size, type, owner and modification time, and ls with a sort option ranks files by size. Once you have the odd file, the stored value was simply reversed, which tools like rev undo. Finding anomalies by metadata first is far faster than opening files one by one.',
    defend: 'Baseline normal and alert on the abnormal: file integrity monitoring and data loss prevention flag exports whose size, owner or timing deviates from the pattern. Keep export directories access controlled and log who reads them.',
    tools: ['find -size', 'ls -lS', 'tail', 'rev', 'cut'],
    next: 'Practise counting and ranking events in logs to find rare visitors.',
  },
  'terminal:medium:2': {
    what: 'Identify the single address that appears only once in a busy web access log and follow it through other logs.',
    how: 'Legitimate clients show up many times while a one-off visitor stands out. Extract the address column, sort it, then uniq with a count and sort again to rank by frequency, so the rarest entries surface. Then grep the whole log tree for that address to pivot across files. The value you finally read was lightly obscured with a simple letter rotation, which tr reverses.',
    defend: 'Aggregate access logs centrally and baseline client behaviour, then alert on rare or first-seen sources reaching sensitive endpoints. Correlate web, application and authentication logs by address and time, and keep the logs tamper resistant for incident response.',
    tools: ['awk', 'sort | uniq -c', 'grep -r', 'tr', 'wc -l'],
    next: 'Look at how configuration changes between backups show up with diff.',
  },
  'terminal:medium:3': {
    what: 'Compare two dated copies of a configuration file and decode the one value that changed.',
    how: 'diff prints only the lines that differ between two files, so a change hidden in hundreds of unchanged settings becomes obvious. The changed value looked like Base64, a reversible text encoding built from letters and digits that is often mistaken for encryption. Decoding it needs no key, which is why encoding never protects a secret.',
    defend: 'Keep configuration in version control or a backup history and review diffs for every change, with alerts on unexpected edits to sensitive settings. Never store secrets in Base64 inside configs. Use a secrets manager and sign or hash configuration files to detect tampering.',
    tools: ['diff', 'base64 -d', 'awk', 'git diff'],
    next: 'Follow clues between files, where one finding names where to look next.',
  },
  'terminal:medium:4': {
    what: 'Follow a pointer from the previous finding into a hidden queue directory and decode a payload from the one suspicious entry.',
    how: 'Earlier evidence told you where to look, which is how real investigations chain. Dot-prefixed folders need ls with the all and long options, and grep or find can single out the entry whose state or owner does not match its neighbours. The payload used two simple layers, a rotation and Base64, peeled off in the reverse order they were applied.',
    defend: 'Monitor queues, spools and job directories for entries owned by unexpected accounts or stuck in odd states. Run services under dedicated low-privilege users, audit file ownership regularly, and alert on writes to hidden directories in system paths.',
    tools: ['ls -la', 'find -user', 'grep -A', 'base64 -d', 'tr'],
    next: 'Learn how permissions and links decide what you can read and where paths really lead.',
  },
  'terminal:medium:5': {
    what: 'Reach a locked-down account through a symbolic link to a surviving copy, then read its shell history and a sealed hex value.',
    how: 'A symbolic link is a pointer to another path, and a copy made before an account was locked can still be reachable through one. ls -l shows the arrow and the real permission bits, and find can list every link or every file an account owns. Shell history files record what a user typed, and a hex string is just bytes written as text that xxd converts back.',
    defend: 'Treat a locked account as incomplete until its data is archived and access to copies is removed. Review symlinks and backup copies for stray permissions, clear or protect shell history on shared hosts, and apply least privilege to home directories.',
    tools: ['ls -l', 'find -type l', 'xxd -r', 'cat .bash_history'],
    next: 'Move to The Vault for long logs, binaries and sudo rules.',
  },

  // ---------------------------------------------------------------- Arena Terminal, hard
  'terminal:hard:1': {
    what: 'Find the single successful request from an address seen only once among thousands of log lines, then decode its reference value.',
    how: 'Count, then rank: extract the address column with awk, sort, uniq with counts and sort numerically so rare sources come first. The status code narrows the list further, because a one-off visitor that received a success is the interesting case. The reference value in the request was hex-encoded and reversed, so converting from hex and flipping it recovers the text.',
    defend: 'Ship web logs to a central store, build detections for first-seen sources that reach sensitive paths, and rate limit or challenge them. Avoid putting meaningful identifiers or tokens in URLs, because they end up in logs, proxies and browser history.',
    tools: ['awk', 'sort | uniq -c', 'grep', 'xxd -r -p', 'rev'],
    next: 'Practise reading scheduled jobs and unwrapping stacked encodings.',
  },
  'terminal:hard:2': {
    what: 'Use a scheduled job to locate a hidden stash and unwrap a file that was encoded in several layers.',
    how: 'Cron tables reveal where automated jobs read and write, and a script shows exactly how its output was wrapped. The layers here were Base64, compression and a reversal. The rule for layered data is to peel them in the opposite order they were applied, checking the shape of the output after each step. Skipping comment lines first keeps the decoder happy.',
    defend: 'Audit crontabs and systemd timers on every host, alert on new or modified scheduled jobs, and keep job scripts under change control. Treat encoding and compression as obfuscation only and never as protection for data that matters.',
    tools: ['crontab -l', 'base64 -d', 'gunzip', 'rev', 'CyberChef'],
    next: 'Try binary files next, where text hides among unreadable bytes.',
  },
  'terminal:hard:3': {
    what: 'Use file timestamps to isolate a recently touched binary and extract readable text from it.',
    how: 'A reference file such as a lockout stamp gives you a point in time, and find with the newer option lists everything modified after it. The file command then tells text from binaries, and strings pulls printable sequences out of a compiled library without running it. The value inside was encoded twice, and the release entry mattered more than the debug one.',
    defend: 'Run file integrity monitoring and compare binaries to known-good hashes from your package manager. Alert on library changes outside patch windows, and use time-based triage during incident response to find everything modified after a compromise began.',
    tools: ['find -newer', 'file', 'strings', 'xxd', 'ghidra'],
    next: 'Learn how hashes identify files when names and paths cannot be trusted.',
  },
  'terminal:hard:4': {
    what: 'Pick the one real key out of dozens of lookalikes by matching its fingerprint to a trusted list, then open an encrypted archive.',
    how: 'A cryptographic hash is a fixed-size fingerprint of file contents, so identical contents give identical hashes whatever the name. The trusted list kept the hash of the right key without its path. Hashing every candidate and comparing finds the match without guessing, which is the same idea behind verifying downloads and detecting tampered files.',
    defend: 'Verify keys and artifacts against hashes or signatures obtained over a separate trusted channel. Prefer SHA-256 over MD5, which is broken for collision resistance. Store keys in a hardware or cloud key management service rather than in a plain directory.',
    tools: ['md5sum', 'sha256sum', 'grep', 'gpg --verify'],
    next: 'Study how sudo rules grant narrow power and where they can be abused.',
  },
  'terminal:hard:5': {
    what: 'Read a root-only file through the one narrow sudo rule you were granted, after tracing where links and processes really point.',
    how: 'sudo -l lists exactly which commands you may run as root. A rule that lets you run cat as root on one directory looks safe but is only as strong as the path checking behind it, because symbolic links inside that directory can point somewhere else. Combining ls -l on the links with the process list shows which file the target daemon writes.',
    defend: 'Apply least privilege in sudoers: list exact commands and arguments, avoid wildcards, never allow editors or interpreters, and use sudoedit for file edits. Resolve and validate paths, forbid user-writable links in privileged directories, and log every sudo invocation.',
    tools: ['sudo -l', 'ls -l', 'ps aux', 'find -type l', 'GTFOBins'],
    next: 'Read about privilege escalation through misconfigured sudo and file permissions.',
  },
  'terminal:hard:6': {
    what: 'Assemble a master secret from three fragments you collected earlier, including one stored as wide characters, and open the final vault.',
    how: 'Splitting a secret into shares means no single piece is enough. Two fragments came from earlier work, and the third sat in a library as wide characters, the format where every letter is followed by an empty byte. strings misses it by default, but xxd shows the text with padding dots between letters. Join the keys in the stated order to open the vault.',
    defend: 'Split critical secrets with a proper scheme such as Shamir secret sharing and give each share to a different custodian. Store keys in an HSM or cloud KMS, require multiple approvers, and monitor access to escrow material.',
    tools: ['xxd', 'strings -e l', 'vault open', 'Shamir secret sharing'],
    next: 'Revisit your notes: the best finish combines findings from every earlier flag.',
  },

  // ---------------------------------------------------------------- Cipher Lab, easy
  'cipherlab:easy:e1': {
    what: 'Decode a message in which every letter was shifted by the same amount along the alphabet.',
    how: 'A Caesar cipher replaces each letter with one a fixed number of places further on, wrapping from Z back to A. The key space is only 25 shifts, so you can try them all and keep the one that produces real words. Frequency analysis helps too: the most common ciphertext letter often stands for E.',
    defend: 'Never rely on a substitution or shift cipher for confidentiality, since it falls to brute force in seconds. Use vetted authenticated encryption such as AES-GCM or ChaCha20-Poly1305 from a maintained library, with properly managed keys.',
    tools: ['ROT13', 'CyberChef', 'frequency analysis', 'dcode.fr'],
    next: 'Try the mirror alphabet in the next level, a cipher with no key at all.',
  },
  'cipherlab:easy:e2': {
    what: 'Decode text written with a mirrored alphabet, where the first letter swaps with the last and so on.',
    how: 'Atbash maps each letter to its opposite in the alphabet. It has no key at all, so the whole security rests on nobody knowing the scheme. It is also its own inverse, because mirroring twice returns the original, which makes decoding the same operation as encoding.',
    defend: 'Security through obscurity fails once the method is known. Under Kerckhoffs principle a system must stay secure when everything except the key is public, so choose standard algorithms and keep only the keys secret.',
    tools: ['CyberChef Atbash', 'dcode.fr', 'tr', 'Python'],
    next: 'Next, learn to recognise stacked encodings such as Base64 around hexadecimal.',
  },
  'cipherlab:easy:e3': {
    what: 'Unwrap a message that was encoded twice, with one text encoding placed inside another.',
    how: 'Base64 and hexadecimal are encodings, not encryption: they change representation and need no key. The outer layer is the one you see, so decode it first and look at what comes out. A string made only of the characters 0 to 9 and A to F is a strong hint for hex. Recognising the shape of each layer is the skill.',
    defend: 'Encoding is not protection. Do not store passwords, tokens or API keys as Base64 or hex, and scan code and configuration for encoded secrets. Use hashing for passwords and real encryption with managed keys for data.',
    tools: ['base64 -d', 'xxd -r -p', 'CyberChef Magic', 'Python'],
    next: 'Try chaining a shift and a reversal in the boss level.',
  },
  'cipherlab:easy:e4': {
    what: 'Undo two simple operations applied in sequence, a letter shift and a full reversal of the text.',
    how: 'When several transformations are chained you must undo them in the reverse order they were applied. Reverse the text first, then try the shifts until readable words appear. Even weak ciphers combined stay weak, because each stage can be attacked on its own once the previous one is removed.',
    defend: 'Chaining weak ciphers does not add up to a strong one. Use a single well-reviewed construction with authenticated encryption, and never design your own scheme. Have cryptography choices reviewed against current guidance such as NIST recommendations.',
    tools: ['CyberChef', 'rev', 'ROT brute force', 'Python'],
    next: 'Medium introduces keyed ciphers, where the shift changes along the message.',
  },

  // ---------------------------------------------------------------- Cipher Lab, medium
  'cipherlab:medium:m1': {
    what: 'Break a keyed polyalphabetic cipher using a known opening word to recover the repeating key.',
    how: 'Vigenere applies a different Caesar shift to each letter based on a repeating keyword. If you know or can guess a word in the plaintext, called a crib, subtracting it from the matching ciphertext letters reveals the key letters directly. Once the key repeats, decode the whole message. Predictable message openings are exactly what makes this attack work.',
    defend: 'Never reuse a short repeating key, and avoid predictable headers or boilerplate in encrypted messages. Modern ciphers use random nonces and long keys so cribs and key length analysis give an attacker nothing to grip.',
    tools: ['Vigenere solver', 'Kasiski examination', 'CyberChef', 'dcode.fr'],
    next: 'Next, see the same key reuse problem at the byte level with XOR.',
  },
  'cipherlab:medium:m2': {
    what: 'Recover a short repeating key from hex-encoded data that was combined with the message using XOR.',
    how: 'XOR is reversible: plaintext XOR key gives ciphertext, and ciphertext XOR key gives plaintext back. So if you know any part of the plaintext, XORing it with the matching ciphertext bytes yields the key bytes. A short key that repeats leaks quickly this way, which is why a repeating-key XOR is closer to obfuscation than encryption.',
    defend: 'Never reuse an XOR keystream or use short repeating keys. A true one-time pad needs a random key as long as the message, used once. In practice use AES-GCM or ChaCha20 with unique nonces, and never roll your own stream cipher.',
    tools: ['xortool', 'CyberChef XOR', 'Python', 'known-plaintext attack'],
    next: 'Try transposition next, where the letters stay the same but change place.',
  },
  'cipherlab:medium:m3': {
    what: 'Rebuild a message that was written in a zig-zag across a number of rails and read off row by row.',
    how: 'A rail fence cipher is a transposition: letters keep their identity but move position. The number of rails is the whole key, and with only a few sensible values you can try them all and see which gives readable text. Letter frequencies of the ciphertext match normal English, which is the tell that it is transposition and not substitution.',
    defend: 'Transposition alone offers almost no security. If layouts must hide data, use modern encryption instead. As a rule, ciphers that preserve letter frequencies should raise a flag in any design review.',
    tools: ['rail fence decoder', 'CyberChef', 'dcode.fr', 'Python'],
    next: 'Substitution with a full shuffled alphabet is the next step up.',
  },
  'cipherlab:medium:m4': {
    what: 'Break a monoalphabetic substitution cipher where every letter maps to one fixed other letter.',
    how: 'There are far too many alphabets to try, but the language leaks through. Count letter frequencies, match the common ones to E and T, then use short common words and word shapes to confirm guesses. Each correct pair reveals more of the text, so the solve snowballs. This is classic frequency analysis.',
    defend: 'Any cipher that always maps a symbol to the same output leaks statistics. Strong ciphers diffuse and randomise output with block modes and unique nonces so frequency analysis does not apply. Test designs against known-plaintext and statistical attacks.',
    tools: ['frequency analysis', 'quipqiup', 'CyberChef', 'dcode.fr'],
    next: 'Hard introduces public-key maths and password hashing.',
  },

  // ---------------------------------------------------------------- Cipher Lab, hard
  'cipherlab:hard:h1': {
    what: 'Decrypt an RSA message whose modulus was small enough to factor, using the recovered private exponent.',
    how: 'RSA security depends on the difficulty of factoring the modulus into its two primes. With tiny primes, trial division finds them instantly. From those you compute the totient, then the private exponent as the modular inverse of the public one, and finally raise the ciphertext to that power modulo n. Key size is the whole defence.',
    defend: 'Use at least 2048-bit RSA keys, or better 3072-bit or elliptic curves, with padding such as OAEP. Generate keys with vetted libraries and secure randomness, and retire weak keys. Scan your estate for undersized keys and certificates.',
    tools: ['RsaCtfTool', 'factordb', 'Python pow', 'openssl'],
    next: 'Next, see how salting changes what an attacker has to do with leaked hashes.',
  },
  'cipherlab:hard:h2': {
    what: 'Recover a password from a salted SHA-256 hash by testing every word on a short suspect list.',
    how: 'A salt is random data prepended to the password before hashing, so identical passwords produce different hashes and precomputed tables stop working. It does not stop a dictionary attack against a single hash, though: you hash each candidate with the known salt and compare. A fast general hash like SHA-256 makes each guess cheap.',
    defend: 'Store passwords with a slow, memory-hard algorithm such as Argon2id, bcrypt or scrypt, with a unique random salt per user and ideally a server-side pepper. Enforce length and breach-list checks, add MFA, and monitor for credential database exposure.',
    tools: ['hashcat', 'John the Ripper', 'Python hashlib', 'wordlists'],
    next: 'Combine hex and keyed ciphers next, and use known openings to shortcut the key.',
  },
  'cipherlab:hard:h3': {
    what: 'Strip a hex layer, then break a keyed cipher whose key is fully exposed by a known opening word.',
    how: 'Peel the outer encoding first, which leaves letters only. The message always begins with a known word that is longer than the key, so lining it up against the first ciphertext letters reveals every key letter and the key repeats from there. Crib length against key length decides how fast such an attack works.',
    defend: 'Avoid fixed message headers when using weak ciphers, and prefer modern authenticated encryption that is indifferent to known plaintext. Treat encoding layers as formatting only and never count them toward security strength.',
    tools: ['CyberChef', 'Vigenere solver', 'xxd -r -p', 'Python'],
    next: 'Try the boss level, which chains four layers you already know.',
  },
  'cipherlab:hard:h4': {
    what: 'Peel four stacked layers from the outside in, each one a technique you already met.',
    how: 'Layered transformations are beaten one layer at a time. Identify the outermost encoding by its shape, decode it, and look again. The inner layers were a transposition with a small number of possible rail counts and a shift with 25 options, both small enough to brute force. Chaining weak steps multiplies work only a little.',
    defend: 'Obfuscation layers do not replace encryption. Malware authors also stack encodings to dodge simple filters, so defenders should decode in a sandbox, normalise content before scanning, and detect layered encoding as a signal in itself.',
    tools: ['CyberChef Magic', 'base64', 'rail fence decoder', 'Python'],
    next: 'Black Chamber removes the hints, so practise recognising each layer by sight.',
  },

  // ---------------------------------------------------------------- Cipher Lab, insane
  'cipherlab:insane:i1': {
    what: 'Recognise and undo three or four chained wrappers with no hints, using the shape of the text at each step.',
    how: 'Without hints, the skill is classification. Long strings of letters and digits ending in equals signs suggest Base64, strings of hex pairs suggest bytes as text, and readable but scrambled words suggest a shift, a mirror or a reversal. Decode the outermost layer, inspect the result, and repeat until sentences appear.',
    defend: 'Decoding pipelines are a daily task for analysts: defenders automate them with tools like CyberChef recipes and sandbox detonation. Detect stacked encodings in email and scripts as a suspicious trait, and block the payloads they hide.',
    tools: ['CyberChef Magic', 'base64', 'xxd', 'Python'],
    next: 'The next level adds a key and a fence, so combine your keyed cipher skills.',
  },
  'cipherlab:insane:i2': {
    what: 'Remove encodings, unscramble a rail fence and break a keyed cipher, using the knowledge that every message begins the same way.',
    how: 'Work from the outside: undo the text encodings, then the transposition by trying each plausible rail count, then the keyed shift. The final step falls once you recall the fixed opening of every transmission, since that known text exposes the key. Systematic order and a repeatable pipeline beat guessing.',
    defend: 'Predictable plaintext structure is a standing weakness against any known-plaintext attack. Use authenticated encryption with random nonces and avoid fixed headers where a weak scheme is in play. Retire legacy ciphers from any product.',
    tools: ['CyberChef', 'rail fence decoder', 'Vigenere solver', 'Python'],
    next: 'Finish with the boss level and chain every layer type together.',
  },
  'cipherlab:insane:i3': {
    what: 'Unwind a five-layer chain with no hints, mixing keyed, transposition and encoding steps.',
    how: 'Order matters: the last layer applied is the first you remove. Here that means peeling the encodings, undoing the reversal and the fence, then solving the keyed cipher with the known opening of the message. Keep notes on each intermediate result, because an error in one layer makes every later layer look like noise.',
    defend: 'Real systems should rely on one standard authenticated cipher, not stacked home-made steps. For analysts the same discipline applies: automate decoding chains, keep intermediate artefacts for evidence, and document each transformation.',
    tools: ['CyberChef', 'Python scripting', 'base64', 'xxd'],
    next: 'Apply the same decoding mindset to Crackme Arcade or Forensics Desk next.',
  },

  // ---------------------------------------------------------------- Challenges
  'challenges:static:caesar-says': {
    what: 'Decode an intercepted message that was encrypted with a classic shift cipher.',
    how: 'A Caesar cipher moves each letter a fixed number of places in the alphabet, so only 25 keys exist. Try every shift and keep the output that reads as language. Punctuation and braces pass through unchanged, which also gives away the structure of the text and the flag format you were hunting.',
    defend: 'A cipher with a tiny key space gives no protection. Use authenticated encryption such as AES-GCM with random keys, and keep the key secret rather than the algorithm. Review any custom crypto in code review and replace it with a maintained library.',
    tools: ['CyberChef ROT13', 'dcode.fr', 'tr', 'Python'],
    next: 'Try the Cipher Lab tracks to meet keyed ciphers and public-key maths.',
  },
  'challenges:docker:cookie-monster': {
    what: 'Become an administrator on a web app by changing a role value stored in your own browser cookie.',
    how: 'The app kept your role in a cookie and trusted it on every request. The value looked like Base64, so you could decode it, see the plain role name and write a new encoded value. Anything the browser sends can be edited with developer tools, so authorisation decisions based on client data are broken access control.',
    defend: 'Keep identity and role on the server in a session store, or in a signed and verified token, and look the role up on each request. Set Secure, HttpOnly and SameSite cookie flags, and check authorisation per endpoint. This maps to OWASP A01 Broken Access Control.',
    tools: ['browser dev tools', 'Burp Suite', 'base64', 'cookie editor'],
    next: 'Explore the Web Exploit Lab cookie and token levels for deeper cases.',
  },
  'challenges:docker:login-bypass': {
    what: 'Sign in to a staff login form without knowing any password by injecting SQL through the input fields.',
    how: 'The login built its database query by pasting your text into a string. A quote character ends the string early, and extra SQL such as an always-true condition or a comment marker changes the logic so the password check disappears. This is SQL injection, possible whenever user input is treated as code instead of data.',
    defend: 'Use parameterised queries or prepared statements and an ORM, validate input on the server, and run the database account with least privilege. Add a web application firewall as a second layer and test with SAST and DAST. This is OWASP A03 Injection.',
    tools: ['sqlmap', 'Burp Suite', 'browser dev tools', 'parameterised queries'],
    next: 'Practise UNION based injection in the Web Exploit Lab hospital track.',
  },
  'challenges:docker:robots-rule': {
    what: 'Find an unlinked admin page by reading the file that tells crawlers which paths to avoid.',
    how: 'robots.txt is a public file that asks search crawlers to skip certain paths. Listing a private page there advertises it to anyone who reads the file, because compliance is voluntary and the file is world readable. Reconnaissance usually begins with such public files, along with sitemaps and page source.',
    defend: 'Do not rely on robots.txt or obscure URLs to hide anything. Protect admin pages with authentication, MFA and network restrictions, and keep sensitive paths out of public indexes. Review robots.txt for information leaks. This relates to OWASP A01 Broken Access Control.',
    tools: ['curl', 'browser', 'gobuster', 'dirsearch'],
    next: 'Next, try directory discovery and path handling in the Web Exploit Lab.',
  },
};
