/// <reference types="jest" />
import { render, screen } from '@testing-library/react-native';

import { GoingStack } from './going-stack';

describe('GoingStack (B10 смоука dev)', () => {
  it('квадраты с иконкой человека, не больше 4; для скринридера — одна подпись', async () => {
    await render(<GoingStack count={12} caption="идут 12 из 20" />);

    expect(screen.getAllByTestId('going-avatar-icon')).toHaveLength(4);
    expect(screen.getByLabelText('идут 12 из 20')).toBeOnTheScreen();
    expect(screen.getByText('идут 12 из 20')).toBeOnTheScreen();
  });

  it('по числу идущих; никого — только подпись', async () => {
    await render(<GoingStack count={2} caption="идут 2" />);
    expect(screen.getAllByTestId('going-avatar-icon')).toHaveLength(2);

    await render(<GoingStack count={0} caption="идут 0" />);
    expect(screen.queryByTestId('going-avatar-icon')).toBeNull();
  });
});
