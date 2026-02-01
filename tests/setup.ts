import { jest } from '@jest/globals';

jest.setTimeout(10000);

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

afterAll(() => {
});
