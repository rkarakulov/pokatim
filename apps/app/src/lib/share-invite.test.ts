/// <reference types="jest" />
import { setShareInvite, withInvite } from './share-invite';

describe('withInvite (P6)', () => {
  afterEach(() => setShareInvite(null));

  it('без кода — путь как есть', () => {
    expect(withInvite('/rides/x')).toBe('/rides/x');
  });

  it('с кодом — ?invite=, путь с запросом — &invite=', () => {
    setShareInvite('K7M2PQX');
    expect(withInvite('/rides/x')).toBe('/rides/x?invite=K7M2PQX');
    expect(withInvite('/?tab=1')).toBe('/?tab=1&invite=K7M2PQX');
  });

  it('сброс (выход) — снова без кода', () => {
    setShareInvite('K7M2PQX');
    setShareInvite(null);
    expect(withInvite('/')).toBe('/');
  });
});
