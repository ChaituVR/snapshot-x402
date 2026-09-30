import Ajv2020 from 'ajv/dist/2020';
import request from 'supertest';
import { fixtureApp, PROPOSAL_ID, VOTER } from './fixture-app';
import examples from '../src/examples.json';
import openapi from '../src/openapi.json';
import proposal from './fixtures/proposal.json';

const ajv = new Ajv2020({
  strict: false,
  validateFormats: false,
  allErrors: true
});
ajv.addSchema(openapi, 'openapi.json');

function validate(schema: string, body: unknown) {
  const check = ajv.getSchema(`openapi.json#/components/schemas/${schema}`);
  if (!check) throw new Error(`No schema ${schema}`);
  check(body);
  return check.errors ?? [];
}

const PAID = [
  ['Space', '/v1/spaces/ens.eth'],
  ['ProposalList', '/v1/spaces/aavedao.eth/proposals?first=1'],
  ['Proposal', `/v1/proposals/${PROPOSAL_ID}?include=body`],
  ['VoteList', `/v1/proposals/${PROPOSAL_ID}/votes?first=2`],
  ['VotingPower', `/v1/vp?voter=${VOTER}&proposal=${PROPOSAL_ID}`]
];

describe('OpenAPI contract', () => {
  it.each(PAID)('%s matches %s', async (schema, path) => {
    const { paid } = fixtureApp();
    const res = await paid(path);

    expect(res.status).toBe(200);
    expect(validate(schema, res.body)).toEqual([]);
  });

  it('keeps nullable proposal fields valid', async () => {
    const sparse = {
      data: {
        proposal: {
          ...proposal.data.proposal,
          symbol: '',
          quorumType: '',
          discussion: '',
          privacy: ''
        }
      }
    };
    const { paid } = fixtureApp(() => ({ body: sparse }));
    const res = await paid(`/v1/proposals/${PROPOSAL_ID}`);

    expect(res.body.symbol).toBeNull();
    expect(validate('Proposal', res.body)).toEqual([]);
  });

  it.each([
    ['Space', examples.space],
    ['ProposalList', examples.proposals],
    ['Proposal', examples.proposal],
    ['VoteList', examples.votes],
    ['VotingPower', examples.vp]
  ])('the %s example matches its schema', (schema, example) => {
    expect(validate(schema, example)).toEqual([]);
  });

  it('describes the JSON service info', async () => {
    const { app } = fixtureApp();
    const res = await request(app).get('/').set('Accept', 'application/json');

    expect(validate('ServiceInfo', res.body)).toEqual([]);
  });

  it.each([
    ['/v1/spaces/ens.eth', 402],
    ['/v1/nope', 404]
  ])('error body of %s matches Error', async (path, status) => {
    const { app } = fixtureApp();
    const res = await request(app).get(path);

    expect(res.status).toBe(status);
    expect(validate('Error', res.body)).toEqual([]);
  });

  it('error body of a paid bad request matches Error', async () => {
    const { paid } = fixtureApp();
    const res = await paid('/v1/spaces/ens.eth/proposals?first=0');

    expect(res.status).toBe(400);
    expect(validate('Error', res.body)).toEqual([]);
  });
});
