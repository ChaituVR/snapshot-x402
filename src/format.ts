type RawStrategy = {
  name: string;
  network?: string | null;
  params?: Record<string, unknown> | null;
};

export const orNull = <T>(value: T | '' | undefined | null): T | null =>
  value === '' || value === undefined ? null : value;

const round = (value: number) => Math.round(value * 1e6) / 1e6;

const INDEX_CHOICE_TYPES = ['single-choice', 'basic'];

export function strategyRef(strategy: RawStrategy) {
  const symbol = strategy.params?.symbol;
  return {
    name: strategy.name,
    network: orNull(strategy.network),
    symbol: typeof symbol === 'string' ? symbol : null
  };
}

export function formatSpace(space: any) {
  const voting = space.voting ?? {};
  return {
    id: space.id,
    name: orNull(space.name),
    about: orNull(space.about),
    network: space.network,
    symbol: orNull(space.symbol),
    avatar: orNull(space.avatar),
    website: orNull(space.website),
    twitter: orNull(space.twitter),
    github: orNull(space.github),
    coingecko: orNull(space.coingecko),
    verified: Boolean(space.verified),
    flagged: Boolean(space.flagged),
    hibernated: Boolean(space.hibernated),
    turbo: Boolean(space.turbo),
    admins: space.admins ?? [],
    moderators: space.moderators ?? [],
    membersCount: space.members?.length ?? 0,
    strategies: (space.strategies ?? []).map(strategyRef),
    proposalValidation: orNull(space.validation?.name),
    voteValidation: orNull(space.voteValidation?.name),
    voting: {
      delay: orNull(voting.delay),
      period: orNull(voting.period),
      type: orNull(voting.type),
      quorum: orNull(voting.quorum),
      quorumType: orNull(voting.quorumType),
      blind: Boolean(voting.blind),
      privacy: orNull(voting.privacy)
    },
    stats: {
      activeProposals: space.activeProposals ?? 0,
      proposals: space.proposalsCount ?? 0,
      proposals30d: space.proposalsCount30d ?? 0,
      followers: space.followersCount ?? 0,
      votes: space.votesCount ?? 0,
      votes7d: space.votesCount7d ?? 0
    },
    treasuries: space.treasuries ?? [],
    delegationPortal: orNull(space.delegationPortal),
    parent: space.parent?.id ?? null,
    children: (space.children ?? []).map((child: { id: string }) => child.id),
    created: space.created,
    link: `https://snapshot.box/#/s:${space.id}`
  };
}

export function formatProposalSummary(proposal: any) {
  return {
    id: proposal.id,
    title: proposal.title,
    author: proposal.author,
    state: proposal.state,
    type: orNull(proposal.type),
    privacy: orNull(proposal.privacy),
    created: proposal.created,
    start: proposal.start,
    end: proposal.end,
    snapshot: orNull(proposal.snapshot),
    choices: proposal.choices ?? [],
    scores: proposal.scores ?? [],
    scoresTotal: orNull(proposal.scores_total),
    scoresState: orNull(proposal.scores_state),
    votes: orNull(proposal.votes),
    quorum: orNull(proposal.quorum),
    quorumType: orNull(proposal.quorumType),
    flagged: Boolean(proposal.flagged),
    link: proposal.link
  };
}

function results(proposal: any) {
  const total: number = proposal.scores_total ?? 0;
  const scores: number[] = proposal.scores ?? [];
  const byStrategy: number[][] = proposal.scores_by_strategy ?? [];
  const choices = (proposal.choices ?? []).map(
    (label: string, index: number) => {
      const score = scores[index] ?? 0;
      return {
        choice: index + 1,
        label,
        score,
        share: total > 0 ? round(score / total) : 0,
        scoreByStrategy: byStrategy[index] ?? []
      };
    }
  );
  return {
    scoresState: orNull(proposal.scores_state),
    scoresTotal: total,
    scoresUpdated: orNull(proposal.scores_updated),
    votes: proposal.votes ?? 0,
    leading: leadingChoice(scores, total),
    choices
  };
}

function leadingChoice(scores: number[], total: number) {
  const best = Math.max(...scores, 0);
  if (total <= 0 || best <= 0) return null;
  const leaders = scores.filter(score => score === best).length;
  return leaders === 1 ? scores.indexOf(best) + 1 : null;
}

export function formatProposal(proposal: any) {
  return {
    id: proposal.id,
    ipfs: orNull(proposal.ipfs),
    space: proposal.space?.id ?? null,
    spaceName: orNull(proposal.space?.name),
    spaceVerified: Boolean(proposal.space?.verified),
    title: proposal.title,
    author: proposal.author,
    state: proposal.state,
    type: orNull(proposal.type),
    privacy: orNull(proposal.privacy),
    created: proposal.created,
    updated: orNull(proposal.updated),
    start: proposal.start,
    end: proposal.end,
    snapshot: orNull(proposal.snapshot),
    network: proposal.network,
    symbol: orNull(proposal.symbol),
    choices: proposal.choices ?? [],
    labels: proposal.labels ?? [],
    quorum: proposal.quorum,
    quorumType: orNull(proposal.quorumType),
    strategies: (proposal.strategies ?? []).map(strategyRef),
    validation: orNull(proposal.validation?.name),
    results: results(proposal),
    discussion: orNull(proposal.discussion),
    app: orNull(proposal.app),
    flagged: Boolean(proposal.flagged),
    link: proposal.link,
    ...(typeof proposal.body === 'string' && { body: proposal.body })
  };
}

export function choiceLabels(proposal: {
  type?: string | null;
  choices?: string[] | null;
}): string[] | null {
  return INDEX_CHOICE_TYPES.includes(proposal.type ?? '')
    ? (proposal.choices ?? [])
    : null;
}

export function formatVote(vote: any, labels: string[] | null = null) {
  const label = Number.isInteger(vote.choice)
    ? labels?.[vote.choice - 1]
    : undefined;
  return {
    id: vote.id,
    voter: vote.voter,
    choice: vote.choice,
    choiceLabel: label ?? null,
    vp: vote.vp,
    vpByStrategy: vote.vp_by_strategy ?? [],
    vpState: orNull(vote.vp_state),
    created: vote.created,
    reason: orNull(vote.reason),
    app: orNull(vote.app)
  };
}
