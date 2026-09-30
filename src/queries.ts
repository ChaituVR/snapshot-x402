export const SPACE = `query Space($id: String!) {
  space(id: $id) {
    id name about network symbol avatar website twitter github coingecko
    verified flagged hibernated turbo admins moderators members
    strategies { name network params }
    validation { name }
    voteValidation { name }
    voting { delay period type quorum quorumType blind privacy }
    activeProposals proposalsCount proposalsCount30d followersCount votesCount votesCount7d
    treasuries { name address network }
    delegationPortal { delegationType delegationContract delegationNetwork }
    parent { id }
    children { id }
    created
  }
}`;

export const SPACE_PROPOSALS = `query SpaceProposals($space: String!, $first: Int!, $skip: Int!, $where: ProposalWhere!) {
  space(id: $space) { id }
  proposals(first: $first, skip: $skip, where: $where, orderBy: "created", orderDirection: desc) {
    id title author created start end snapshot state type choices
    scores scores_total scores_state votes quorum quorumType privacy flagged link
  }
}`;

export const PROPOSAL = `query Proposal($id: String!, $withBody: Boolean!) {
  proposal(id: $id) {
    id ipfs title author created updated start end snapshot state type choices labels
    quorum quorumType privacy network symbol discussion app link flagged
    scores scores_by_strategy scores_state scores_total scores_updated votes
    strategies { name network params }
    validation { name }
    space { id name verified }
    body @include(if: $withBody)
  }
}`;

export const PROPOSAL_VOTES = `query ProposalVotes($id: String!, $first: Int!, $skip: Int!, $orderBy: String!) {
  proposal(id: $id) { id state type privacy choices votes scores_state space { id } }
  votes(first: $first, skip: $skip, where: { proposal: $id }, orderBy: $orderBy, orderDirection: desc) {
    id voter created choice vp vp_by_strategy vp_state reason app
  }
}`;

export const VP_PROPOSAL = `query VpProposal($id: String!) {
  proposal(id: $id) { id state network snapshot strategies { name network params } space { id } }
}`;

export const VP_SPACE = `query VpSpace($id: String!) {
  space(id: $id) { id network strategies { name network params } }
}`;
