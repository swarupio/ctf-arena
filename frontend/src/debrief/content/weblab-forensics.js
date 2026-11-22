// Debrief content for the Web Exploit Lab and Forensics Desk (shown after a team captures the flag).
// Keys are category:track:level, exactly as in src/skills/levelSkills.js. Plain text only, no values from the
// per-team generated data, never an answer.
export default {
  // ---- Web Exploit Lab: RetroBank ----
  'weblab:easy:sqli-login': {
    what: 'You got past a login form without knowing any password by changing what the database was asked.',
    how: 'The form pasted your username straight into the SQL text. A quote character closed the string early, and a comment marker made the database ignore the password check that followed. The query then matched a user on the name alone. The bug is mixing data with code: the database cannot tell which part you were supposed to control.',
    defend: 'Use parameterised queries or an ORM so input is always bound as data. Add least-privilege database accounts, generic login errors, and alerts on quote characters and SQL keywords in credential fields.',
    tools: ['Burp Suite Repeater', 'sqlmap', 'OWASP Cheat Sheet Series'],
    next: 'Try the UNION-based lookup in the Mercy General track, where the query result itself becomes the leak.',
  },
  'weblab:easy:cookie-tamper': {
    what: 'You changed a cookie the browser stored and the server believed it, which unlocked a restricted page.',
    how: 'The site kept a privilege flag inside a cookie that was only encoded, not signed. Encoding such as Base64 is a format, not protection: anyone can decode it, edit a field and encode it again. The server trusted whatever came back, so you promoted yourself without logging in as anyone.',
    defend: 'Keep authorisation state on the server and store only an opaque session id in the cookie. If data must live client-side, sign it with an HMAC or use a vetted session library, and re-check roles on every request.',
    tools: ['Browser developer tools', 'Burp Suite Decoder', 'CyberChef'],
    next: 'Compare this with the token levels in the pizza track, where a signature exists and the question is how well it is checked.',
  },
  'weblab:easy:idor-statements': {
    what: 'You read records that belonged to other customers by walking through neighbouring identifiers in the URL.',
    how: 'An insecure direct object reference means the server finds a record by the id you send and never asks whether it is yours. Sequential ids make guessing trivial: change one number, get someone else data. The login proves who you are, but nothing checked what you may see, which is broken access control.',
    defend: 'Enforce object-level ownership checks on the server for every read, not just at login. Prefer unguessable identifiers as a second layer, write authorisation tests per endpoint, and alert on one account enumerating many ids.',
    tools: ['Burp Intruder', 'ffuf', 'Autorize extension'],
    next: 'Watch for the same idea hiding inside the final NovaCorp chain, where a leaked profile is the first link.',
  },

  // ---- Web Exploit Lab: Slice of Life Pizza ----
  'weblab:medium:path-traversal': {
    what: 'You made a file-serving endpoint hand over files outside the folder it was meant to expose.',
    how: 'The menu endpoint built a file path from your input, and its filter removed the dot-dot-slash sequence only once. Doubling or re-encoding the sequence made the leftovers join into a fresh traversal after cleaning. Climbing out of the web folder reached configuration that pointed to a backup. Filtering bad strings is fragile; resolving paths is not.',
    defend: 'Resolve the final path to its canonical form and verify it stays inside an allowed base directory. Better still, map user input to an allow-list of ids, and run the service with file permissions that cannot reach secrets.',
    tools: ['Burp Repeater', 'dotdotpwn', 'curl with path-as-is'],
    next: 'See how a traversal becomes the last step of a longer chain in the NovaCorp track.',
  },
  'weblab:medium:xss-filter': {
    what: 'You slipped script-capable markup past a sanitiser that removed only the most obvious patterns.',
    how: 'Cross-site scripting happens when text you control is returned as markup a browser may execute. This filter deleted a few exact lowercase strings in one pass, so changed capitalisation, other tags with event handlers, or nested fragments that reassemble after removal still survived. Blocklists lose because browsers accept far more spellings than the list knows.',
    defend: 'Encode output for its context so input is always shown as text, and use a maintained sanitiser library for rich content. Add a strict Content-Security-Policy, HttpOnly cookies, and review reflected parameters in web application firewall logs.',
    tools: ['Burp Suite', 'XSS Hunter', 'DOMPurify', 'browser developer tools'],
    next: 'Read about context-aware output encoding, then compare it with the filter you just beat.',
  },
  'weblab:medium:jwt-none': {
    what: 'You forged a login token that claimed a higher role, and the kitchen service accepted it without a signature.',
    how: 'A JSON Web Token carries a header naming its signing algorithm. This service honoured the value none, meaning unsigned, so it skipped verification entirely and trusted the claims. You rebuilt the token with a privileged role and an empty signature. The flaw is letting the token, which the attacker controls, choose how it gets checked.',
    defend: 'Pin the expected algorithm on the server with an allow-list and reject none. Use a well-maintained JWT library with verification on by default, keep tokens short-lived, and log tokens that fail signature checks.',
    tools: ['jwt.io', 'jwt_tool', 'Burp JWT Editor', 'CyberChef'],
    next: 'Continue to the Staff SSO lab, where the algorithm is correct but the secret is the weak point.',
  },

  // ---- Web Exploit Lab: Mercy General Hospital ----
  'weblab:hard:sqli-union': {
    what: 'You used injection to make a search form return data from tables it was never meant to show.',
    how: 'With a UNION clause you append a second query whose results are merged into the page. First you probe how many columns the original query returns, then you match that shape and ask the database catalogue which tables exist, and finally read the interesting one. Error messages and visible output turn a lookup box into a data export.',
    defend: 'Bind all input as parameters and never concatenate. Give the application account read access only to the tables it needs, hide database error details from users, and monitor for catalogue queries and UNION keywords from the web tier.',
    tools: ['sqlmap', 'Burp Suite', 'database information schema'],
    next: 'Practise blind injection next, where nothing is printed and you infer answers from behaviour.',
  },
  'weblab:hard:jwt-weak-secret': {
    what: 'You recovered the key that signs staff tokens by guessing it, then issued yourself an administrator token.',
    how: 'An HMAC-signed token is only as strong as its secret. If the secret is a common word, you can test candidates offline against a captured token without touching the server, so no lockout or rate limit helps. Once you know the key you sign any claims you like, and the server cannot distinguish them from genuine ones.',
    defend: 'Generate signing keys from a cryptographic random source with at least 256 bits and store them in a secrets manager. Rotate on schedule, prefer asymmetric signing for multi-service setups, and scan repositories for committed secrets.',
    tools: ['hashcat mode 16500', 'john the ripper', 'jwt_tool', 'wordlists such as rockyou'],
    next: 'Look at how the NovaCorp track leaks a key by other means instead of guessing it.',
  },
  'weblab:hard:race-refill': {
    what: 'You redeemed a one-time voucher several times by sending near-simultaneous requests.',
    how: 'The server checked whether the voucher was used, then recorded the use a moment later. Requests that arrive inside that gap all pass the check before any of them writes, so each one pays out. This is a time-of-check to time-of-use race. It appears wherever a limit is enforced by read-then-write logic instead of one indivisible operation.',
    defend: 'Make the check and the update a single atomic operation, such as a conditional update or a unique constraint, or use row locks and transactions. Add idempotency keys for payments and reconcile balances to detect abuse.',
    tools: ['Burp Turbo Intruder', 'curl with parallel jobs', 'single-packet attack technique'],
    next: 'Read about atomic database operations and idempotency keys, then look for read-then-write patterns in code you know.',
  },

  // ---- Web Exploit Lab: NovaCorp Cloud ----
  'weblab:insane:chain-vault': {
    what: 'You chained three separate weaknesses, each small alone, into full access to a protected vault.',
    how: 'Real intrusions are rarely one bug. An unchecked object reference exposed another staff profile that leaked a signing key. That key let you forge a token with admin rights, and the admin export feature then had a path flaw that reached a file outside its folder. Each step supplied the access the next one needed.',
    defend: 'Apply defence in depth so one failure is not fatal: ownership checks, secrets kept out of API responses, rotated keys, strict path resolution and least privilege per role. Detect chains by correlating odd reads, new admin tokens and file access.',
    tools: ['Burp Suite', 'jwt_tool', 'ffuf', 'attack path notes'],
    next: 'Write your own attack chain as a short report: for each step, name the bug and the control that would have broken the chain.',
  },

  // ---- Forensics Desk: The Midnight Login (log analysis) ----
  'forensics:easy:1': {
    what: 'You identified the one address that kept failing to log in and then finally succeeded.',
    how: 'A brute-force attack leaves a recognisable shape: many failed attempts from one source, then an accepted one. Searching the authentication lines and counting by source address makes the pattern stand out from background noise. The success that follows a burst of failures is what separates an attacker from a forgetful user.',
    defend: 'Rate-limit and lock out repeated failures, require key-based SSH or MFA, and alert when a failed burst is followed by a success from the same source. Tools such as fail2ban automate the first response.',
    tools: ['grep and sort', 'awk', 'fail2ban', 'SIEM search'],
    next: 'Practise counting events by field in a log with a one-line pipeline, then repeat with another field.',
  },
  'forensics:easy:2': {
    what: 'You worked out which account the intruder reached first by narrowing the log to one source.',
    how: 'Once you have a suspicious address, filtering every line by it turns a huge log into a short story. The first successful authentication in that story names the account that was compromised, which is where containment and password resets must start. Pivoting on one indicator to find the next is the basic investigative move.',
    defend: 'Centralise authentication logs with consistent fields so pivots are fast. Disable or reset the first compromised account immediately, review its recent activity, and detect logins from addresses that earlier produced failures.',
    tools: ['grep', 'journalctl', 'Splunk or Elastic queries'],
    next: 'Try pivoting on the account instead of the address and see what else it did.',
  },
  'forensics:easy:3': {
    what: 'You pinned down the exact moment of the breach from the first successful login.',
    how: 'Every log line carries a timestamp, and the first accepted login after the failures marks the point of compromise. Everything before it was attempt, everything after is potential damage. Knowing the time lets you bound the investigation window and line it up against other sources. Always check which time zone the log uses.',
    defend: 'Synchronise clocks with NTP across all systems, log in UTC, and ship logs off the host so an intruder cannot rewrite them. Build timelines from several sources to confirm a single time stamp.',
    tools: ['timeline notes', 'date and TZ conversion', 'log2timeline'],
    next: 'Build a small timeline of the night so far and note which events happen before and after the breach.',
  },
  'forensics:easy:4': {
    what: 'You found what the intruder took by spotting an unusually large successful download.',
    how: 'Data theft over a web service looks like a normal request, so you recognise it by size and context rather than by signature. A successful response with a very large byte count, to the same address that just broke in, stands out against ordinary traffic. Reading the status code and size fields in each line is what reveals it.',
    defend: 'Monitor outbound volume and per-user download size, alert on large transfers soon after a new login, and apply data loss prevention to sensitive paths. Keep access logs long enough to scope what was taken.',
    tools: ['grep with regex', 'awk for field extraction', 'web server access logs'],
    next: 'Sort a log by response size and ask which entries are normal for that site and which are not.',
  },
  'forensics:easy:5': {
    what: 'You combined every confirmed clue and matched them to the single person they all describe.',
    how: 'Individual facts rarely convict anyone: several people may match one or two clues. Attribution works by requiring that all independent pieces of evidence agree, and rejecting candidates that match only part of the picture. This stage trains the discipline of confirming each fact first, then correlating them, rather than guessing from one.',
    defend: 'Separate evidence from inference in incident reports and record how each fact was verified. Require corroboration from independent sources before naming a cause, and keep chain-of-custody notes for anything that may be reviewed.',
    tools: ['evidence matrix', 'case notes', 'timeline tooling'],
    next: 'Try the packet investigation next, where the same correlation skill runs over network traffic.',
  },

  // ---- Forensics Desk: Operation Quiet Beacon (packet analysis) ----
  'forensics:medium:1': {
    what: 'You found the workstation that was contacting an outside server again and again at a steady rhythm.',
    how: 'Malware that checks in with its controller, called beaconing, produces regular traffic that humans do not. Filtering a capture to one protocol and looking for a repeating request pattern isolates it. Be careful: legitimate software also polls on timers, so you must check the destination and content before blaming a host.',
    defend: 'Baseline normal outbound traffic and flag periodic connections to rare destinations. Use egress filtering, DNS and proxy logging, and endpoint detection to confirm which process owns the connection.',
    tools: ['Wireshark display filters', 'tshark', 'Zeek', 'RITA'],
    next: 'Open a real sample capture in Wireshark and practise filtering by protocol and conversation.',
  },
  'forensics:medium:2': {
    what: 'You identified the name the infected host resolved just before it started calling its controller.',
    how: 'Before a machine connects to a domain it must resolve it through DNS, so the lookup sits right before the first beacon in the capture. Filtering DNS traffic from the suspect host and reading the queries in time order reveals the name. Decoy lookups exist, so the link between the lookup and the later traffic is what you verify.',
    defend: 'Log all DNS queries and feed them to threat intelligence and newly-seen-domain alerts. Use a filtering resolver or sinkhole for known command-and-control names, and restrict workstations to approved resolvers.',
    tools: ['Wireshark dns filter', 'passive DNS', 'Zeek dns.log', 'threat intelligence feeds'],
    next: 'Learn how DNS tunnelling and fast-flux domains differ from the simple lookup you just found.',
  },
  'forensics:medium:3': {
    what: 'You measured the interval between the implant check-ins from the timestamps of consecutive packets.',
    how: 'Beacon timing is a fingerprint. Subtracting the timestamps of two consecutive check-ins gives the sleep interval, and a stable value confirms automation. Real malware often adds jitter to blur this, which is why analysts look at several samples. Distinguishing this implant from other periodic traffic depends on filtering to the right destination first.',
    defend: 'Use statistical beacon detection on flow data, looking at regularity and size consistency. Combine it with destination reputation, and respond by isolating the host and capturing memory before the process disappears.',
    tools: ['Wireshark time deltas', 'tshark field export', 'RITA', 'spreadsheet or Python'],
    next: 'Export timestamps from a capture and plot the gaps to see what jitter looks like.',
  },
  'forensics:medium:4': {
    what: 'You followed a connection to a drop server, decoded its payload and read the label hidden inside the stolen data.',
    how: 'Following a stream reassembles the pieces of one conversation in order, so a payload split over many packets reads as one message. Attackers often wrap stolen data in Base64 to make it look like harmless text. Decoding it shows what was taken. This is exfiltration over a custom channel, spotted by who received data it had no business receiving.',
    defend: 'Block or inspect uncommon outbound ports, apply egress allow-lists and data loss prevention, and alert on encoded blobs sent to unfamiliar hosts. Retain packet capture or flow logs on sensitive segments to scope a leak afterwards.',
    tools: ['Wireshark Follow TCP Stream', 'CyberChef', 'NetworkMiner', 'base64 command'],
    next: 'Practise reassembling and decoding a multi-packet transfer, then note which fields gave the exfiltration away.',
  },
  'forensics:medium:5': {
    what: 'You matched the confirmed network evidence against a list of people to name the one who fits every clue.',
    how: 'Network facts such as an address, a domain, an interval and a stolen item each describe a host or a person only partly. Several suspects match some of them. Attribution requires that the full set of independent facts agree, and a single mismatch rules a candidate out. Good analysts also state what they could not confirm.',
    defend: 'Tie network identifiers to asset and user inventories so addresses map to owners quickly, and keep DHCP and authentication logs to prove who held an address at a given time. Report conclusions with confidence levels.',
    tools: ['asset inventory', 'DHCP and VPN logs', 'case notes'],
    next: 'Take the artefact investigation next, where evidence lives inside files rather than on the wire.',
  },

  // ---- Forensics Desk: The Photographer's Alibi (file and image forensics) ----
  'forensics:hard:1': {
    what: 'You found data hidden after the end of an image file, where viewers never look.',
    how: 'A JPEG ends at a specific marker, and most viewers stop reading there. Anything appended afterwards is ignored when the picture is displayed but still sits in the file, so a hex editor shows it at the tail. Here the trailing text was encoded, a common way to keep it from showing up in a plain strings search.',
    defend: 'Scan uploaded and outbound images for data after the end-of-image marker, and strip or re-encode files before publishing. In investigations, hash files and carve tails routinely, since attackers use this to smuggle data.',
    tools: ['hex editor such as HxD', 'xxd', 'binwalk', 'strings'],
    next: 'Open any image in a hex editor, find its start and end markers, and see what a file signature looks like.',
  },
  'forensics:hard:2': {
    what: 'You pulled an owner identifier out of metadata the photographer forgot was there.',
    how: 'Photos carry embedded metadata called EXIF: camera model, timestamps, sometimes location and free-text comments. People rarely check it, so identifiers leak through it. Here a comment field held the handle in an encoded form, which you decoded. Metadata is evidence about the person and the device, not about the picture.',
    defend: 'Strip metadata from files before sharing them and teach staff that photos carry hidden fields. Investigators should preserve the original file, read metadata with trusted tools, and treat it as claimed rather than proven, since it can be edited.',
    tools: ['exiftool', 'ExifTool GUI', 'CyberChef', 'strings'],
    next: 'Run exiftool on a photo of your own and list which fields you would not want to publish.',
  },
  'forensics:hard:3': {
    what: 'You read a short message hidden in the lowest bits of an image, after finding which channel and bit order held it.',
    how: 'Least-significant-bit steganography changes the lowest bit of each colour value, too small for the eye to see, yet those bits can spell a message. You must choose the colour channel and the reading order that makes the bits form readable text, so you test the combinations until one decodes. Visual inspection alone never reveals it.',
    defend: 'Detect it with statistical tests such as chi-square analysis and by comparing against known originals. Controls include re-compressing or resizing images at trust boundaries, and watching for unusual file sizes and entropy on exfiltration paths.',
    tools: ['zsteg', 'StegSolve', 'steghide', 'Python with Pillow'],
    next: 'Learn how a lossy re-save such as JPEG compression destroys this kind of hidden data.',
  },
  'forensics:hard:4': {
    what: 'You recovered a note from a disk after the suspect had deleted it, using the way file systems really remove data.',
    how: 'Deleting a file usually removes only its directory entry and marks the space as reusable. The content remains until something overwrites it, so a disk listing can still show deleted entries with their timestamps. Several notes looked alike, so recognising which was newest, using modification times, was the real skill. Deleted does not mean gone.',
    defend: 'For secure disposal use full-disk encryption plus cryptographic erase, or overwrite media; deletion alone is not enough. For investigators, image the disk read-only, verify hashes, and work on the copy to keep evidence admissible.',
    tools: ['Autopsy', 'The Sleuth Kit', 'photorec', 'FTK Imager'],
    next: 'Read how file system metadata such as inodes and the master file table record deleted files.',
  },
  'forensics:hard:5': {
    what: 'You tied together four pieces of file evidence and picked the only person who matched all of them.',
    how: 'Several suspects shared two or three of the clues, so no single artefact identified anyone. A hidden passphrase, a handle, a key and a token each point at a different attribute. Confirming all four and rejecting near matches mirrors real attribution, where partial overlap is common and is the main source of wrongful conclusions.',
    defend: 'Document every artefact with its source and hash so findings can be re-checked, and require independent corroboration before attributing actions to a person. Maintain chain of custody for seized media and review conclusions with a second analyst.',
    tools: ['hash tools such as sha256sum', 'evidence log', 'case notes'],
    next: 'Move on to the longest case, where the evidence chains from one stage into the next.',
  },

  // ---- Forensics Desk: The Long Night (combined investigation) ----
  'forensics:insane:1': {
    what: 'You separated the genuine intruder from several look-alikes and found the persistent account they created.',
    how: 'Persistence means the attacker adds a way back in, here a new account created with elevated rights after the breach. Noisy logs hold decoys: scanners that never get in, an innocent remote login, an administrator who also adds users. You decide by ordering events in time and checking which actor was actually compromised before the account appeared.',
    defend: 'Alert on account creation and privilege changes, especially from unusual sessions, and require approval workflows for new privileged users. Audit sudo use, review accounts regularly, and respond by removing the account and rotating credentials.',
    tools: ['auditd', 'grep over auth logs', 'SIEM correlation rules', 'last and lastlog'],
    next: 'Practise telling a normal admin action from a malicious one by checking who, when and from where.',
  },
  'forensics:insane:2': {
    what: 'You carried a finding from the log into the capture and measured the real attacker beacon among decoys.',
    how: 'The capture holds more than one periodic signal, including an innocent one and a second beacon on another rhythm. The attacker address learned from the log tells you which traffic to keep. Only after that filter does the interval mean anything. This is cross-source correlation, where one data set tells you how to read another.',
    defend: 'Correlate network and host telemetry in one place so an indicator from one source drives a search in the other. Build detections on destination plus timing, and keep enough capture or flow history to answer such questions later.',
    tools: ['Wireshark filters', 'tshark', 'Zeek', 'SIEM threat hunting'],
    next: 'Write down the indicator you used to cross from one source to another and how you would automate it.',
  },
  'forensics:insane:3': {
    what: 'You worked out which file the implant was ordered to steal and recovered a deleted note about it from the disk.',
    how: 'The command reply from the controller was encoded, and decoding it named the target file. A deleted entry related to that file still survived on disk and held a token. The chain matters: network evidence told you what to look for, and disk evidence confirmed it. Look-alike deleted files exist, so matching on the right name is the check.',
    defend: 'Inspect command-and-control traffic for encoded tasking, restrict implants with application allow-listing, and keep file integrity monitoring on sensitive data. For disposal, rely on encryption and secure erase rather than plain deletion.',
    tools: ['Autopsy', 'The Sleuth Kit', 'CyberChef', 'Wireshark HTTP header view'],
    next: 'Practise decoding a header value found in a capture, then locating the matching artefact on a disk image.',
  },
  'forensics:insane:4': {
    what: 'You picked the one correct image out of several and extracted the key hidden inside it.',
    how: 'Only one of the pictures carried a real message; the others held filler that looked similar. The recovered note told you which to examine, so the earlier stages decided which evidence deserved effort. Extracting least-significant-bit data from the right image and channel then produced the key. Triage, not brute force, is what keeps large cases manageable.',
    defend: 'Treat unexplained image-heavy transfers as possible covert channels, and use content inspection at egress. In investigations, prioritise artefacts using findings from other sources and record why each item was or was not examined.',
    tools: ['zsteg', 'StegSolve', 'Python with Pillow', 'exiftool'],
    next: 'Try writing a short script that reads bits from one channel, so you understand what the tools do for you.',
  },
  'forensics:insane:5': {
    what: 'You assembled four chained findings and named the person who fits every one while decoys fit only part.',
    how: 'By this stage each answer came from a different source: logs, network capture, disk and image. The suspects were built to look innocent, with partial matches on purpose. Naming the culprit means checking every confirmed clue against every candidate and accepting nobody who fails a single one, then stating the evidence trail behind the conclusion.',
    defend: 'Write incident reports that list each finding, its source and its confidence, and have a second analyst challenge the conclusion. Preserve evidence with hashes and custody records so the result can withstand review, and feed lessons back into detections.',
    tools: ['evidence matrix', 'timeline tooling', 'incident report template'],
    next: 'Write a one-page incident summary of this case with timeline, evidence, and one control that would have shortened the investigation.',
  },
};
