// Evidence ids of the case board (docs/OSINT_TRAIL.md "Case board"). An id is "<source>:<id>" and always names something
// a player can already browse in the desk: a post, a profile, a page, a document, a domain, a photo, a paste or a landmark.
export const EVIDENCE_KINDS = ['feed', 'cast', 'pages', 'docs', 'registry', 'photos', 'pastes', 'map'];
export const EVIDENCE_ID = /^(feed|cast|pages|docs|registry|photos|pastes|map):[a-z0-9][a-z0-9._-]{0,63}$/;
export const ev = (kind, id) => `${kind}:${id}`;

// The relation vocabulary. Short and public: it says what a link may mean, never which links exist.
export const RELATIONS = [
  { id: 'posted', label: 'posted / wrote', help: 'A person wrote, posted or edited this post, document or paste.' },
  { id: 'at', label: 'was at', help: 'A post or photo happened at this place on the map.' },
  { id: 'owns', label: 'owns / registered', help: 'A person is the registered owner of this domain.' },
  { id: 'mentions', label: 'mentions / points to', help: 'One item names or points to another.' },
  { id: 'linked', label: 'linked to', help: 'Two things are tied together by a shared code, address, timestamp or bio.' },
];
export const RELATION_IDS = RELATIONS.map((r) => r.id);
