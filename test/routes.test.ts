import { PROPOSAL_ID, fixtureApp as setup, VOTER } from './fixture-app';
import proposal from './fixtures/proposal.json';
import votes from './fixtures/votes.json';
import { operation, Upstream } from './helpers';

describe('GET /v1/spaces/:id', () => {
  it('returns the trimmed space', async () => {
    const { paid, fetchFn } = setup();
    const res = await paid('/v1/spaces/ENS.eth');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'ens.eth',
      name: 'ENS',
      membersCount: 6,
      proposalValidation: 'basic',
      strategies: [
        { name: 'delegation', network: '1', symbol: 'ENS (delegated)' },
        { name: 'erc20-votes', network: '1', symbol: 'ENS' }
      ],
      stats: { proposals: 98, followers: 143061 },
      children: ['wg.ensnominations.eth'],
      link: 'https://snapshot.box/#/s:ens.eth'
    });
    expect(res.body).not.toHaveProperty('members');
    expect(fetchFn.mock.calls[0][1]?.body).toContain('"id":"ens.eth"');
  });

  it('caches upstream answers', async () => {
    const { paid, fetchFn } = setup();
    await paid('/v1/spaces/ens.eth');
    const res = await paid('/v1/spaces/ens.eth');

    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for an unknown space', async () => {
    const { paid } = setup(() => ({
      body: { data: { space: null } }
    }));
    const res = await paid('/v1/spaces/nope.eth');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'not_found', message: 'Space nope.eth not found' }
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each(['no-dot', 'a b.eth', `${'a'.repeat(61)}.eth`])(
    'rejects space id %s',
    async id => {
      const { paid, fetchFn } = setup();
      const res = await paid(`/v1/spaces/${encodeURIComponent(id)}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
      expect(fetchFn).not.toHaveBeenCalled();
    }
  );
});

describe('GET /v1/spaces/:id/proposals', () => {
  it('lists proposals with the filters', async () => {
    const { paid, fetchFn } = setup();
    const res = await paid(
      '/v1/spaces/aavedao.eth/proposals?state=active&first=5&skip=10'
    );

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=30');
    expect(res.body).toMatchObject({
      space: 'aavedao.eth',
      state: 'active',
      first: 5,
      skip: 10,
      hasMore: false,
      next: null
    });
    expect(res.body.items[0]).toMatchObject({
      id: '0x1263de6a670a74faa98e422b7b77865e9b92870818b446ef0959f43823562c12',
      scoresTotal: 862.6650823964607,
      scoresState: 'pending',
      privacy: null
    });
    expect(
      JSON.parse(fetchFn.mock.calls[0][1]?.body as string).variables
    ).toEqual({
      space: 'aavedao.eth',
      first: 5,
      skip: 10,
      where: { space: 'aavedao.eth', state: 'active' }
    });
  });

  it('links the next page when the page is full', async () => {
    const { paid } = setup();
    const res = await paid('/v1/spaces/aavedao.eth/proposals?first=1');

    expect(res.body).toMatchObject({
      hasMore: true,
      next: '/v1/spaces/aavedao.eth/proposals?first=1&skip=1'
    });
  });

  it('stops linking pages past skip 5000', async () => {
    const { paid } = setup();
    const res = await paid(
      '/v1/spaces/aavedao.eth/proposals?state=closed&first=1&skip=5000'
    );

    expect(res.body).toMatchObject({ hasMore: true, next: null });
  });

  it('returns 404 when the space does not exist', async () => {
    const { paid } = setup(() => ({
      body: { data: { space: null, proposals: [] } }
    }));
    expect((await paid('/v1/spaces/nope.eth/proposals')).status).toBe(404);
  });

  it.each([
    'state=bogus',
    'first=0',
    'first=101',
    'first=1.5',
    'skip=5001',
    'skip=-1',
    'first=1&first=2'
  ])('rejects %s', async query => {
    const { paid, fetchFn } = setup();
    const res = await paid(`/v1/spaces/ens.eth/proposals?${query}`);

    expect(res.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('GET /v1/proposals/:id', () => {
  it('returns results per choice', async () => {
    const { paid } = setup();
    const res = await paid(
      `/v1/proposals/${PROPOSAL_ID.toUpperCase().replace('0X', '0x')}`
    );

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(res.body).toMatchObject({
      id: PROPOSAL_ID,
      space: 'aavedao.eth',
      spaceName: 'Aave DAO',
      spaceVerified: true,
      privacy: null,
      validation: 'any',
      strategies: [
        { symbol: 'AAVE in stkBPT' },
        { symbol: 'AAVE gov V3 Voting Power' }
      ]
    });
    expect(res.body.results).toMatchObject({
      scoresState: 'final',
      votes: 97,
      leading: 1,
      choices: [
        { choice: 1, label: 'For', share: 1 },
        { choice: 2, label: 'Against', score: 0, share: 0 },
        { choice: 3, label: 'Abstain' }
      ]
    });
    expect(res.body).not.toHaveProperty('body');
  });

  it('asks for the body only with include=body', async () => {
    const { paid, fetchFn } = setup();
    await paid(`/v1/proposals/${PROPOSAL_ID}?include=body`);

    expect(
      JSON.parse(fetchFn.mock.calls[0][1]?.body as string).variables
    ).toEqual({
      id: PROPOSAL_ID,
      withBody: true
    });
  });

  it('keeps IPFS ids as they are', async () => {
    const { paid, fetchFn } = setup();
    const id = 'QmW5qrWwivELsMdLViGMTmH27QQYjyqGM2PMqVwpYxL2UN';
    await paid(`/v1/proposals/${id}`);

    expect(
      JSON.parse(fetchFn.mock.calls[0][1]?.body as string).variables.id
    ).toBe(id);
  });

  it('returns no leading choice while scores are hidden', async () => {
    const hidden = {
      data: {
        proposal: {
          ...proposal.data.proposal,
          state: 'active',
          privacy: 'shutter',
          scores: [0, 0, 0],
          scores_total: 0,
          scores_state: 'pending'
        }
      }
    };
    const { paid } = setup(() => ({ body: hidden }));
    const res = await paid(`/v1/proposals/${PROPOSAL_ID}`);

    expect(res.body.results.leading).toBeNull();
    expect(res.body.privacy).toBe('shutter');
    expect(res.headers['cache-control']).toBe('private, max-age=30');
  });

  it('reports no leading choice on a tie', async () => {
    const tied = {
      data: {
        proposal: {
          ...proposal.data.proposal,
          scores: [5, 5, 0],
          scores_total: 10
        }
      }
    };
    const { paid } = setup(() => ({ body: tied }));
    const res = await paid(`/v1/proposals/${PROPOSAL_ID}`);

    expect(res.body.results.leading).toBeNull();
    expect(res.body.results.choices[0].share).toBe(0.5);
  });

  it.each(['garbage', '0x1234', `${PROPOSAL_ID}?include=votes`])(
    'rejects %s',
    async id => {
      const { paid } = setup();
      expect((await paid(`/v1/proposals/${id}`)).status).toBe(400);
    }
  );
});

describe('GET /v1/proposals/:id/votes', () => {
  it('lists votes with the proposal choices', async () => {
    const { paid, fetchFn } = setup();
    const res = await paid(
      `/v1/proposals/${PROPOSAL_ID}/votes?first=2&orderBy=created`
    );

    expect(res.status).toBe(200);
    expect(res.body.proposal).toEqual({
      id: PROPOSAL_ID,
      space: 'aavedao.eth',
      state: 'closed',
      type: 'basic',
      privacy: null,
      choices: ['For', 'Against', 'Abstain']
    });
    expect(res.body).toMatchObject({
      orderBy: 'created',
      first: 2,
      skip: 0,
      total: 97,
      hasMore: true,
      next: `/v1/proposals/${PROPOSAL_ID}/votes?orderBy=created&first=2&skip=2`
    });
    expect(res.body.items[0]).toEqual({
      id: '0x6c763b0de137ac2760123607312aad08c760fd1d2c5d89ce13ef0e2906459043',
      voter: VOTER,
      choice: 1,
      choiceLabel: 'For',
      vp: 107243.98459054,
      vpByStrategy: [0, 107243.98459054],
      vpState: 'final',
      created: 1790183180,
      reason: null,
      app: 'snapshot-v2'
    });
    expect(
      JSON.parse(fetchFn.mock.calls[0][1]?.body as string).variables
    ).toMatchObject({
      orderBy: 'created',
      first: 2
    });
  });

  it('has no next page once every vote was listed', async () => {
    const { paid } = setup(call =>
      operation(call) === 'ProposalVotes'
        ? {
            body: {
              data: {
                ...votes.data,
                proposal: { ...votes.data.proposal, votes: 3 }
              }
            }
          }
        : undefined
    );
    const res = await paid(`/v1/proposals/${PROPOSAL_ID}/votes?first=3`);

    expect(res.body).toMatchObject({ total: 3, hasMore: false, next: null });
  });

  it('labels choices only for single-choice and basic votes', async () => {
    const approval = {
      data: {
        ...votes.data,
        proposal: { ...votes.data.proposal, type: 'approval' },
        votes: [{ ...votes.data.votes[0], choice: [1, 2] }]
      }
    };
    const { paid } = setup(() => ({ body: approval }));
    const res = await paid(`/v1/proposals/${PROPOSAL_ID}/votes`);

    expect(res.body.items[0]).toMatchObject({
      choice: [1, 2],
      choiceLabel: null
    });
  });

  it('rejects an unknown orderBy', async () => {
    const { paid } = setup();
    expect(
      (await paid(`/v1/proposals/${PROPOSAL_ID}/votes?orderBy=voter`)).status
    ).toBe(400);
  });
});

describe('GET /v1/vp', () => {
  it('computes voting power at the proposal snapshot', async () => {
    const { paid, fetchFn } = setup();
    const res = await paid(`/v1/vp?voter=${VOTER}&proposal=${PROPOSAL_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(res.body).toEqual({
      voter: VOTER.toLowerCase(),
      space: 'aavedao.eth',
      proposal: PROPOSAL_ID,
      network: '1',
      snapshot: 26026309,
      vp: 107243.98459054,
      vpState: 'final',
      vpByStrategy: [
        {
          name: 'contract-call',
          network: '1',
          symbol: 'AAVE in stkBPT',
          vp: 0
        },
        {
          name: 'contract-call',
          network: '1',
          symbol: 'AAVE gov V3 Voting Power',
          vp: 107243.98459054
        }
      ]
    });
    const scoreCall = fetchFn.mock.calls[1];
    expect(scoreCall[0]).toBe('https://score.snapshot.org');
    expect(JSON.parse(scoreCall[1]?.body as string)).toMatchObject({
      method: 'get_vp',
      params: {
        address: VOTER.toLowerCase(),
        network: '1',
        snapshot: 26026309,
        space: 'aavedao.eth'
      }
    });
  });

  it('uses the latest block for a space', async () => {
    const { paid, fetchFn } = setup(call =>
      operation(call) === 'get_vp'
        ? {
            body: {
              jsonrpc: '2.0',
              result: { vp: 1, vp_by_strategy: [0, 1], vp_state: 'pending' }
            }
          }
        : undefined
    );
    const res = await paid(`/v1/vp?voter=${VOTER}&space=ens.eth`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      space: 'ens.eth',
      proposal: null,
      snapshot: 'latest',
      vpState: 'pending'
    });
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(
      JSON.parse(fetchFn.mock.calls[1][1]?.body as string).params.snapshot
    ).toBe('latest');
  });

  it.each([
    ['no voter', 'space=ens.eth'],
    ['a bad voter', 'voter=0xnope&space=ens.eth'],
    ['neither space nor proposal', `voter=${VOTER}`]
  ])('rejects %s', async (_name, query) => {
    const { paid, fetchFn } = setup();
    expect((await paid(`/v1/vp?${query}`)).status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a proposal from another space', async () => {
    const { paid } = setup();
    const res = await paid(
      `/v1/vp?voter=${VOTER}&space=ens.eth&proposal=${PROPOSAL_ID}`
    );

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('belongs to space aavedao.eth');
  });
});

describe('upstream failures', () => {
  it.each([
    [
      'a hub 500',
      { status: 500, body: { errors: [{ message: 'boom' }] } },
      502,
      'upstream_error'
    ],
    [
      'a hub 429',
      { status: 429, body: {}, headers: { 'ratelimit-reset': '12' } },
      503,
      'upstream_rate_limited'
    ],
    [
      'a hub 401',
      { status: 401, body: { error: 'invalid api key' } },
      502,
      'upstream_error'
    ],
    ['bad JSON', { body: '<html>' }, 502, 'upstream_error']
  ])('maps %s and does not charge', async (_name, upstream, status, code) => {
    const { paid, facilitator } = setup(() => upstream as Upstream);
    const res = await paid('/v1/spaces/ens.eth');

    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain('test-key');
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('answers a malformed path with 400 and does not charge', async () => {
    const { paid, facilitator, fetchFn } = setup();
    const res = await paid('/v1/spaces/%E0%A4%A');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('passes Retry-After from the upstream rate limit', async () => {
    const { paid } = setup(() => ({
      status: 429,
      body: {},
      headers: { 'ratelimit-reset': '12' }
    }));
    expect((await paid('/v1/spaces/ens.eth')).headers['retry-after']).toBe(
      '12'
    );
  });
});
