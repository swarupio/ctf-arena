// A transactional model double: queued transactions isolate snapshots and restore
// both collections on failure. This tests rollback contracts without MongoDB.
export function installTeamStore(User, Team) {
  const state = { users: new Map(), teams: new Map() };
  let sequence = 0;
  let queue = Promise.resolve();
  const nextId = () => (++sequence).toString(16).padStart(24, '0');
  const copy = (value) => value == null ? value : structuredClone(value);
  const duplicate = (field) => Object.assign(new Error('duplicate key'), {
    code: 11000, keyPattern: { [field]: 1 },
  });
  const findUser = (filter) => [...state.users.values()].find((user) => (
    (filter._id === undefined || user._id === filter._id)
    && (filter.cognitoSub === undefined || user.cognitoSub === filter.cognitoSub)
    && (!Object.hasOwn(filter, 'teamId') || user.teamId === filter.teamId)
  ));

  state.addUser = (sub, teamId = null) => {
    const user = { _id: nextId(), cognitoSub: sub, email: `${sub}@example.com`, displayName: sub, role: 'player', teamId };
    state.users.set(user._id, user);
    return copy(user);
  };
  state.addTeam = (members, overrides = {}) => {
    const team = {
      _id: nextId(), name: 'Team Alpha', inviteCode: 'ABCDEF', captainId: members[0]._id,
      memberIds: members.map((member) => member._id), banned: false, ...overrides,
    };
    state.teams.set(team._id, team);
    for (const member of members) { state.users.get(member._id).teamId = team._id; }
    return copy(team);
  };

  User.db.transaction.mockImplementation((work) => {
    const task = queue.then(async () => {
      const snapshot = copy({ users: state.users, teams: state.teams });
      try { return await work({ transaction: true }); }
      catch (error) {
        state.users = snapshot.users;
        state.teams = snapshot.teams;
        throw error;
      }
    });
    queue = task.catch(() => {});
    return task;
  });
  User.findOne.mockImplementation(async (filter) => copy(findUser(filter) ?? null));
  User.find.mockImplementation(async (filter) => [...state.users.values()]
    .filter((user) => filter._id.$in.includes(user._id)).map(copy));
  User.findOneAndUpdate.mockImplementation(async (filter, update, options = {}) => {
    let user = findUser(filter);
    if (!user && options.upsert) {
      user = { _id: nextId(), teamId: null, ...filter, ...update.$setOnInsert };
      state.users.set(user._id, user);
    }
    if (!user) { return null; }
    Object.assign(user, update.$set);
    return copy(user);
  });
  Team.create.mockImplementation(async ([fields]) => {
    if ([...state.teams.values()].some((team) => team.name.toLowerCase() === fields.name.toLowerCase())) {
      throw duplicate('name');
    }
    if ([...state.teams.values()].some((team) => team.inviteCode === fields.inviteCode)) {
      throw duplicate('inviteCode');
    }
    const team = { _id: nextId(), banned: false, ...copy(fields) };
    state.teams.set(team._id, team);
    return [copy(team)];
  });
  Team.findOne.mockImplementation(async (filter) => copy(
    [...state.teams.values()].find((team) => team.inviteCode === filter.inviteCode) ?? null,
  ));
  Team.findById.mockImplementation(async (id) => copy(state.teams.get(String(id)) ?? null));
  Team.findOneAndUpdate.mockImplementation(async (filter, update) => {
    const team = [...state.teams.values()].find((entry) => entry.inviteCode === filter.inviteCode);
    if (!team || (filter['memberIds.2']?.$exists === false && team.memberIds.length >= 3)
        || team.memberIds.includes(filter.memberIds?.$ne)) { return null; }
    team.memberIds.push(update.$push.memberIds);
    return copy(team);
  });
  Team.updateOne.mockImplementation(async (filter, update) => {
    const team = state.teams.get(filter._id);
    if (!team) { return { matchedCount: 0 }; }
    Object.assign(team, copy(update.$set));
    return { matchedCount: 1 };
  });
  Team.deleteOne.mockImplementation(async (filter) => ({ deletedCount: Number(state.teams.delete(filter._id)) }));
  return state;
}
