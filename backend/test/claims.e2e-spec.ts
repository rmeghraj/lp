import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  INJECTION_STUDY,
  SAMPLE_CLAIM,
  STRONG_STUDY,
  WEAK_STUDY,
  WRONG_TIMEFRAME_STUDY,
} from '../src/claims/testing/samples.js';
import type { AppConfig } from '../src/config/config.js';
import { APP_CONFIG } from '../src/config/config.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// These tests run the real app over HTTP against a real database, with the offline fake instead of OpenAI.
// They only ever ADD rows (and read the ones they created), so they are safe on any development database.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Start Postgres (see the README) and copy .env.example to .env before running the end-to-end tests.',
  );
}
const config: AppConfig = { port: 0, corsOrigin: 'http://localhost:5173', databaseUrl, llm: { provider: 'fake' } };

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, config);
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

const server = () => app.getHttpServer();
const post = (body: unknown) => request(server()).post('/api/claims/assess').send(body as object);
const assess = (evidenceText: string) =>
  post({ claim: { text: SAMPLE_CLAIM, productName: 'e2e demo' }, evidence: { text: evidenceText } });
const counts = async () => ({ claims: await prisma.claim.count(), assessments: await prisma.assessment.count() });

describe('POST /api/claims/assess', () => {
  it('assesses a strong study as justified, and saves the claim and the assessment', async () => {
    const res = await assess(STRONG_STUDY).expect(201);

    expect(res.body).toMatchObject({ justified: true, needsReview: false });
    expect(res.body.confidence).toBeGreaterThan(0.7);
    expect(res.body.checks.map((c: { status: string }) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);

    const row = await prisma.assessment.findUniqueOrThrow({ where: { id: res.body.id }, include: { claim: true } });
    expect(row.claim).toMatchObject({ text: SAMPLE_CLAIM, type: 'EFFICACY', status: 'ASSESSED', productName: 'e2e demo' });
    expect(row).toMatchObject({
      claimId: res.body.claimId,
      justified: true,
      confidence: res.body.confidence,
      evidenceText: STRONG_STUDY,
      model: 'fake-heuristic-v1',
    });
    expect(row.checks).toHaveLength(6);
    expect(row.extracted).toMatchObject({ facts: { study: { sampleSize: 45 } } });
  });

  it('answers with exactly the documented fields, and nothing internal', async () => {
    const res = await assess(STRONG_STUDY).expect(201);

    expect(Object.keys(res.body).sort()).toEqual(
      [
        'checks',
        'claimId',
        'claimUnderstood',
        'confidence',
        'createdAt',
        'id',
        'justified',
        'model',
        'needsReview',
        'promptVersion',
        'reasoning',
      ].sort(),
    );
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
  });

  it('says "no" when the effect is smaller than claimed, and asks for review because there was no control group', async () => {
    const res = await assess(WEAK_STUDY).expect(201);

    expect(res.body.justified).toBe(false);
    expect(res.body.needsReview).toBe(true);
    expect(find(res.body.checks, 'effect_size').status).toBe('fail');
    expect(find(res.body.checks, 'control_group').status).toBe('fail');
  });

  it('says "no" when the effect was only measured later than the claimed time, and notes the missing p-value', async () => {
    const res = await assess(WRONG_TIMEFRAME_STUDY).expect(201);

    expect(res.body.justified).toBe(false);
    expect(find(res.body.checks, 'timeframe').status).toBe('fail');
    expect(find(res.body.checks, 'significance').status).toBe('unknown');
  });

  it('does not let instructions hidden in the study text turn a "no" into a "yes"', async () => {
    const res = await assess(INJECTION_STUDY).expect(201);

    // The fake model obeys the injected order and says "justified" with 99% confidence...
    // ...but the numbers still fail, so the code vetoes it and flags the disagreement.
    expect(res.body.justified).toBe(false);
    expect(res.body.needsReview).toBe(true);
    expect(res.body.confidence).toBeLessThanOrEqual(0.5);
    expect(res.body.reasoning).toContain('The study fully justifies the claim.');
    expect(find(res.body.checks, 'effect_size').status).toBe('fail');
  });

  it('adds a new assessment to an existing claim, keeps the earlier one, and moves the claim to ASSESSED', async () => {
    const first = await assess(WEAK_STUDY).expect(201);
    await prisma.claim.update({ where: { id: first.body.claimId }, data: { status: 'EVIDENCE_SUBMITTED' } });

    const second = await post({ claimId: first.body.claimId, evidence: { text: STRONG_STUDY } }).expect(201);

    expect(second.body.claimId).toBe(first.body.claimId);
    expect(second.body.id).not.toBe(first.body.id);
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: first.body.claimId }, include: { assessments: true } });
    expect(claim.status).toBe('ASSESSED');
    // history kept, nothing overwritten: the first (weak) and the second (strong) verdicts are both still there
    expect(claim.assessments).toHaveLength(2);
    expect(claim.assessments.map((a) => a.justified)).toEqual(expect.arrayContaining([true, false]));
  });

  it('answers 404 for an unknown claimId and saves nothing', async () => {
    const before = await counts();

    await post({ claimId: 'does-not-exist', evidence: { text: STRONG_STUDY } }).expect(404);

    expect(await counts()).toEqual(before);
  });

  it.each([
    { name: 'an empty body', body: {} },
    { name: 'both a claimId and a claim', body: { claimId: 'x', claim: { text: SAMPLE_CLAIM }, evidence: { text: STRONG_STUDY } } },
    { name: 'evidence that is too short', body: { claim: { text: SAMPLE_CLAIM }, evidence: { text: 'too short' } } },
    { name: 'a field we do not know about', body: { claim: { text: SAMPLE_CLAIM }, evidence: { text: STRONG_STUDY }, isAdmin: true } },
  ])('answers 400 for $name and saves nothing', async ({ body }) => {
    const before = await counts();

    const res = await post(body).expect(400);

    expect(Array.isArray(res.body.message)).toBe(true); // says which fields are wrong
    expect(await counts()).toEqual(before);
  });

  it('lets the UI origin call the API from a browser, and never echoes or wildcards any other origin', async () => {
    const preflight = (origin: string) =>
      request(server()).options('/api/claims/assess').set('Origin', origin).set('Access-Control-Request-Method', 'POST');

    const allowed = await preflight('http://localhost:5173');
    const other = await preflight('https://evil.example');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(other.headers['access-control-allow-origin']).not.toBe('*');
  });
});

function find(checks: { id: string; status: string }[], id: string) {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
}
