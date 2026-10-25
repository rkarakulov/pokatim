// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ME } from '../test/app';
import { Can } from './can';
import { ME_QUERY_KEY } from './me';
import { safeNext } from './next';

afterEach(cleanup);

describe('safeNext — возврат только внутрь панели', () => {
  it.each([
    ['/', '/'],
    ['/members?status=active', '/members?status=active'],
    ['/audit#top', '/audit#top'],
  ])('%s — как есть', (value, expected) => {
    expect(safeNext(value)).toBe(expected);
  });

  it.each([
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    'members',
    '',
    '/a\nb',
    42,
    undefined,
  ])('%s — отбрасывается', (value) => {
    expect(safeNext(value)).toBeUndefined();
  });
});

function renderWith(me: (typeof ME)[keyof typeof ME]) {
  const client = new QueryClient();
  client.setQueryData(ME_QUERY_KEY, me);
  render(
    <QueryClientProvider client={client}>
      <Can permission="members.manage" fallback={<span>нет</span>}>
        <span>есть</span>
      </Can>
    </QueryClientProvider>,
  );
}

describe('Can / useCan — по правам из PanelMe (только отображение)', () => {
  it('admin — видит', () => {
    renderWith(ME.admin);
    expect(screen.getByText('есть')).toBeTruthy();
  });

  it('moderator — fallback', () => {
    renderWith(ME.moderator);
    expect(screen.getByText('нет')).toBeTruthy();
  });
});
