// Footer text for the backend replica that answered the last API call (the X-Served-By header holds the replica's host name).
export const replicaLabel = (name) => {
  const value = String(name ?? '').trim();
  return value ? `Replica: ${value}` : 'Replica: not contacted yet';
};

export const REPLICA_HINT = 'The backend replica that answered the last request (X-Served-By header).';
